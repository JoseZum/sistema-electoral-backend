-- ===================================================================
-- Migracion: fn_import_students tolerante a conflictos de email
-- Fecha: 2026-08-27
-- ===================================================================
-- Problema que resuelve:
--   students.email es UNIQUE, pero el upsert del padron solo resolvia
--   conflictos con ON CONFLICT (carnet). Cuando un correo ya existente
--   en la BD llegaba asociado a un carnet distinto (estudiante que
--   cambia de carnet y conserva el correo, o correos que se cruzan
--   entre dos carnets), el INSERT violaba students_email_key (23505)
--   y abortaba la importacion COMPLETA con rollback.
--
-- Estrategia nueva (dos pasos previos al upsert masivo):
--   Paso A - Migracion de identidad: si el correo entrante pertenece
--            en la BD a un carnet que NO viene en el padron, se asume
--            que es la misma persona con carnet nuevo y se actualiza
--            el carnet del registro existente. Conserva el UUID, y con
--            el sus votos, tokens y trazas de auditoria.
--   Paso B - Liberacion de correos en transito: para el resto de
--            colisiones (ambos carnets vienen en el padron con los
--            correos cruzados), se asigna un correo temporal unico
--            que libera la restriccion; el upsert posterior asigna
--            el correo definitivo de cada uno.
--
-- Tras ambos pasos ningun correo entrante colisiona, y el upsert
-- original se ejecuta sin cambios.
--
-- Compatibilidad: el JSON de resumen conserva los 5 campos originales
-- (total, new, updated, reactivated, deactivated) y agrega dos campos
-- nuevos (carnet_migrated, email_swapped) que el frontend puede
-- ignorar sin romperse.
-- ===================================================================

CREATE OR REPLACE FUNCTION fn_import_students(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_new INT := 0;
    v_updated INT := 0;
    v_reactivated INT := 0;
    v_deactivated INT := 0;
    v_total INT := 0;
    v_carnet_migrated INT := 0;
    v_email_swapped INT := 0;
    v_incoming_carnets TEXT[];
    v_actor_carnet TEXT;
BEGIN
    -- Obtiene el actor desde variables de sesion para auditoria.
    v_actor_carnet := current_setting('app.actor_carnet', true);

    -- Activa bandera de importacion masiva para evitar logs individuales
    -- por cada fila en triggers de students.
    PERFORM set_config('app.bulk_import', 'true', true);

    -- Recolecta carnets validos del JSON de entrada.
    SELECT array_agg(NULLIF(trim(x->>'Carnet'), ''))
    INTO v_incoming_carnets
    FROM jsonb_array_elements(p_data) x
    WHERE NULLIF(trim(x->>'Carnet'), '') IS NOT NULL
      AND NULLIF(trim(x->>'Nombre'), '') IS NOT NULL
      AND NULLIF(trim(x->>'Correo'), '') IS NOT NULL;

    v_total := coalesce(array_length(v_incoming_carnets, 1), 0);

    -- Si no hay datos validos, retorna resumen en cero.
    IF v_total = 0 THEN
        RETURN jsonb_build_object(
            'total', 0, 'new', 0, 'updated', 0,
            'reactivated', 0, 'deactivated', 0,
            'carnet_migrated', 0, 'email_swapped', 0
        );
    END IF;

    -- Vista normalizada de las filas validas del padron entrante.
    DROP TABLE IF EXISTS tmp_incoming;
    CREATE TEMP TABLE tmp_incoming ON COMMIT DROP AS
    SELECT DISTINCT ON (lower(trim(x->>'Correo')))
        trim(x->>'Carnet')          AS carnet,
        lower(trim(x->>'Correo'))   AS email_lower
    FROM jsonb_array_elements(p_data) x
    WHERE NULLIF(trim(x->>'Carnet'), '') IS NOT NULL
      AND NULLIF(trim(x->>'Nombre'), '') IS NOT NULL
      AND NULLIF(trim(x->>'Correo'), '') IS NOT NULL;

    -- ── Paso A: migracion de identidad (carnet nuevo, mismo correo) ──
    -- El correo entrante pertenece a un carnet que ya no esta en el
    -- padron: es la misma persona con carnet reasignado. Se actualiza
    -- el carnet en vez de intentar crear un registro duplicado.
    WITH migrated AS (
        UPDATE students s
        SET carnet = i.carnet,
            updated_at = NOW()
        FROM tmp_incoming i
        WHERE lower(s.email) = i.email_lower
          AND s.carnet <> i.carnet
          AND s.carnet <> ALL(v_incoming_carnets)
          AND NOT EXISTS (SELECT 1 FROM students t WHERE t.carnet = i.carnet)
        RETURNING s.id
    )
    SELECT count(*) INTO v_carnet_migrated FROM migrated;

    -- ── Paso B: liberacion de correos en transito ──
    -- Colisiones restantes: el correo entrante pertenece a otro carnet
    -- que tambien viene en el padron (correos cruzados). Se libera con
    -- un valor temporal unico; el upsert siguiente asigna el definitivo.
    WITH swapped AS (
        UPDATE students s
        SET email = '__migrating__' || s.carnet || '__' || s.id::text,
            updated_at = NOW()
        WHERE EXISTS (
            SELECT 1 FROM tmp_incoming i
            WHERE lower(s.email) = i.email_lower
              AND s.carnet <> i.carnet
        )
        RETURNING s.id
    )
    SELECT count(*) INTO v_email_swapped FROM swapped;

    -- Cuenta estudiantes realmente nuevos (carnet inexistente en BD).
    -- Se calcula DESPUES del paso A: los carnets migrados ya existen.
    SELECT count(*) INTO v_new
    FROM unnest(v_incoming_carnets) c
    WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.carnet = c);

    -- Cuenta reactivados (carnet existente con is_active = false).
    SELECT count(*) INTO v_reactivated
    FROM unnest(v_incoming_carnets) c
    JOIN students s ON s.carnet = c
    WHERE s.is_active = false;

    -- Upsert de todos los estudiantes entrantes y reactivacion implicita.
    INSERT INTO students (carnet, full_name, email, sede, career, degree_level, is_active)
    SELECT
        NULLIF(trim(x->>'Carnet'), ''),
        NULLIF(trim(x->>'Nombre'), ''),
        NULLIF(trim(x->>'Correo'), ''),
        NULLIF(trim(x->>'Sede'), ''),
        NULLIF(trim(x->>'Carrera'), ''),
        COALESCE(NULLIF(trim(x->>'Grado'), ''), 'NO_ESPECIFICADO'),
        true
    FROM jsonb_array_elements(p_data) x
    WHERE NULLIF(trim(x->>'Carnet'), '') IS NOT NULL
      AND NULLIF(trim(x->>'Nombre'), '') IS NOT NULL
      AND NULLIF(trim(x->>'Correo'), '') IS NOT NULL
    ON CONFLICT (carnet) DO UPDATE
    SET
        full_name = EXCLUDED.full_name,
        email = EXCLUDED.email,
        sede = EXCLUDED.sede,
        career = EXCLUDED.career,
        degree_level = EXCLUDED.degree_level,
        is_active = true,
        updated_at = NOW();

    -- Actualizados = total - nuevos - reactivados.
    -- Corresponde a registros existentes que ya estaban activos.
    v_updated := v_total - v_new - v_reactivated;

    -- Desactiva estudiantes activos que no vienen en el padron importado.
    WITH deactivated AS (
        UPDATE students
        SET is_active = false, updated_at = NOW()
        WHERE is_active = true
          AND carnet != ALL(v_incoming_carnets)
        RETURNING id
    )
    SELECT count(*) INTO v_deactivated FROM deactivated;

    DROP TABLE IF EXISTS tmp_incoming;

    -- Registra una unica entrada de auditoria con el resumen global.
    INSERT INTO audit_logs (actor_carnet, action, resource_type, details, ip_address)
    VALUES (
        v_actor_carnet,
        'padron.import',
        'padron',
        jsonb_build_object(
            'total', v_total,
            'new', v_new,
            'updated', v_updated,
            'reactivated', v_reactivated,
            'deactivated', v_deactivated,
            'carnet_migrated', v_carnet_migrated,
            'email_swapped', v_email_swapped
        ),
        current_setting('app.client_ip', true)
    );

    RETURN jsonb_build_object(
        'total', v_total,
        'new', v_new,
        'updated', v_updated,
        'reactivated', v_reactivated,
        'deactivated', v_deactivated,
        'carnet_migrated', v_carnet_migrated,
        'email_swapped', v_email_swapped
    );
END;
$$;

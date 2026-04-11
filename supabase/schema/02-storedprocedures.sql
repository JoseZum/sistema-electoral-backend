-- ============================================================
-- STORED PROCEDURES DE VOTACION Y GESTION DE PADRON
--
-- Contenido:
-- 1) fn_cast_vote_anonymous: registra voto anonimo usando token.
-- 2) fn_cast_vote_named: registra voto no anonimo con student_id.
-- 3) fn_import_students: importa padron con diff completo.
--
-- Nota:
-- Estas funciones aplican validaciones de integridad y actualizan el
-- estado de participacion en election_voters.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Registrar voto anonimo por token
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_cast_vote_anonymous(
    p_election_id UUID,
    p_option_id UUID,
    p_token_hash TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_token_record RECORD;
    v_now TIMESTAMPTZ := now();
BEGIN
    -- Verifica que el token exista, pertenezca a la eleccion y no haya sido usado.
    SELECT * INTO v_token_record
    FROM voting_tokens
    WHERE election_id = p_election_id
      AND token_hash = p_token_hash
      AND used = false
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Token inválido o ya utilizado';
    END IF;

    -- Verifica que la opcion seleccionada pertenece a la eleccion.
    IF NOT EXISTS (
        SELECT 1 FROM election_options
        WHERE id = p_option_id AND election_id = p_election_id
    ) THEN
        RAISE EXCEPTION 'Opción no pertenece a esta elección';
    END IF;

    -- Inserta el voto anonimo usando token_hash (sin student_id).
    INSERT INTO votes(election_id, option_id, token_hash)
    VALUES (p_election_id, p_option_id, p_token_hash);

    -- Marca el token como utilizado para impedir reutilizacion.
    UPDATE voting_tokens
    SET used = true,
        used_at = v_now
    WHERE election_id = p_election_id
      AND student_id = v_token_record.student_id;

    -- Marca al votante como participante en election_voters.
    UPDATE election_voters
    SET token_used = true,
        token_used_at = v_now
    WHERE election_id = p_election_id
      AND student_id = v_token_record.student_id;

    -- Elimina material sensible del token para reducir trazabilidad posterior.
    -- Conserva solamente el estado de uso y las marcas temporales requeridas.
    UPDATE voting_tokens
    SET token_hash = NULL,
        token_encrypted = NULL
    WHERE election_id = p_election_id
      AND student_id = v_token_record.student_id;
END;
$$;

-- ------------------------------------------------------------
-- 2) Registrar voto no anonimo por identidad del estudiante
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_cast_vote_named(
    p_election_id UUID,
    p_option_id UUID,
    p_student_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    -- Verifica que el estudiante este habilitado para votar en la eleccion.
    IF NOT EXISTS (
        SELECT 1 FROM election_voters
        WHERE election_id = p_election_id
          AND student_id = p_student_id
    ) THEN
        RAISE EXCEPTION 'Votante no es elegible para esta elección';
    END IF;

    -- Verifica que la opcion seleccionada pertenece a la eleccion.
    IF NOT EXISTS (
        SELECT 1 FROM election_options
        WHERE id = p_option_id AND election_id = p_election_id
    ) THEN
        RAISE EXCEPTION 'Opción no pertenece a esta elección';
    END IF;

    -- Inserta el voto vinculado al student_id.
    -- La restriccion UNIQUE de la tabla votes previene doble voto.
    INSERT INTO votes(election_id, option_id, student_id)
    VALUES (p_election_id, p_option_id, p_student_id);

    -- Marca al votante como participante en election_voters.
    UPDATE election_voters
    SET token_used = true, token_used_at = now()
    WHERE election_id = p_election_id
      AND student_id = p_student_id;
END;
$$;

-- ------------------------------------------------------------
-- 3) Importar padron con diff completo
-- ------------------------------------------------------------
-- Estrategia aplicada:
-- - Inserta estudiantes nuevos.
-- - Actualiza estudiantes existentes.
-- - Reactiva estudiantes que estaban inactivos y reaparecen.
-- - Desactiva estudiantes activos que no vienen en el padron importado.
-- - Registra una unica traza de auditoria con resumen de resultados.
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
            'reactivated', 0, 'deactivated', 0
        );
    END IF;

    -- Cuenta estudiantes realmente nuevos (carnet inexistente en BD).
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
            'deactivated', v_deactivated
        ),
        current_setting('app.client_ip', true)
    );

    RETURN jsonb_build_object(
        'total', v_total,
        'new', v_new,
        'updated', v_updated,
        'reactivated', v_reactivated,
        'deactivated', v_deactivated
    );
END;
$$;

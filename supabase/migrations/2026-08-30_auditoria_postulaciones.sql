-- =========================================================
-- MIGRACION: AUDITORIA DEL MODULO DE POSTULACIONES
--
-- La bitacora se llenaba de ruido ilegible al trabajar con formularios
-- de postulacion. Esta migracion reescribe fn_audit_log para:
--
--   1. Silenciar los INSERT de puestos que ocurren dentro de la creacion
--      de un formulario. Se insertan uno por uno, asi que una convocatoria
--      con cuatro puestos generaba cinco eventos; ahora el evento del
--      formulario los resume en positions_summary.
--   2. Silenciar el reguero de DELETE en cascada al borrar un formulario:
--      el evento application_form.delete ya cuenta la historia completa.
--   3. Enriquecer los eventos de puestos con el titulo del formulario, para
--      que la bitacora diga "Presidencia en Convocatoria TEE 2026" y no un UUID.
--   4. Descartar los UPDATE cuyo unico cambio es updated_at. El trigger de
--      timestamp lo mueve en cada guardado, asi que guardar un formulario sin
--      tocar nada dejaba un evento vacio.
--   5. Ampliar el recorte de datos personales del postulante: la bitacora la
--      ve cualquier administrador y no necesita correo ni nombre escrito a
--      mano; el nombre del padron ya viaja aparte en target_name.
--
-- Requiere 2026-08-30_audit_get_volatilidad.sql: sin esa correccion los
-- interruptores de sesion que usa esta funcion no son confiables.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- =========================================================

CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER AS $$
DECLARE
  v_action      TEXT;
  v_resource_id TEXT;
  v_resource    JSONB;
  v_details     JSONB;
  v_old         JSONB;
  v_new         JSONB;
  v_tag_name    TEXT;
  v_target_name TEXT;
  v_target_carnet TEXT;
BEGIN
  -- Skip individual student logs during bulk import
  IF TG_ARGV[0] = 'student' AND _audit_get('app.bulk_import') = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_ARGV[0] = 'election_option' AND TG_OP = 'INSERT' AND _audit_get('app.compound_election_mode') = 'true' THEN
    RETURN NEW;
  END IF;

  -- Cuando se elimina una eleccion completa, el cascade FK dispara
  -- triggers de DELETE en election_options. Esos eventos son ruido:
  -- el evento de election.delete ya cuenta la historia.
  IF TG_OP = 'DELETE' AND _audit_get('app.cascade_election_delete') = 'true'
     AND TG_ARGV[0] IN ('election_option') THEN
    RETURN OLD;
  END IF;

  IF TG_ARGV[0] = 'tag_member' AND _audit_get('app.compound_tag_mode') = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Los presets de subopciones son configuracion auxiliar y no deben
  -- aparecer en la bitacora de auditoria.
  IF TG_ARGV[0] = 'suboption_preset' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Los puestos de un formulario se insertan uno por uno durante la creacion.
  -- Auditarlos por separado convertia una sola accion del administrador en N
  -- eventos; el evento de application_form.insert los resume. Los puestos que
  -- se agregan despues, sobre un formulario ya creado, si son un cambio real
  -- y se siguen auditando.
  IF TG_ARGV[0] = 'application_position' AND TG_OP = 'INSERT'
     AND _audit_get('app.compound_application_mode') = 'true' THEN
    RETURN NEW;
  END IF;

  -- Borrar un formulario arrastra en cascada sus puestos y sus postulaciones.
  -- Mismo criterio que en elecciones: el evento del formulario basta.
  IF TG_OP = 'DELETE' AND _audit_get('app.cascade_application_form_delete') = 'true'
     AND TG_ARGV[0] IN ('application_position', 'application') THEN
    RETURN OLD;
  END IF;

  -- Accion
  v_action := TG_ARGV[0] || '.' || lower(TG_OP);

  -- Resource ID
  IF TG_OP = 'DELETE' THEN
    v_resource := to_jsonb(OLD);
  ELSE
    v_resource := to_jsonb(NEW);
  END IF;

  v_resource_id := COALESCE(
    v_resource ->> 'id',
    CASE
      WHEN v_resource ? 'election_id' AND v_resource ? 'student_id' THEN
        concat(v_resource ->> 'election_id', ':', v_resource ->> 'student_id')
      WHEN v_resource ? 'election_id' AND v_resource ? 'member_id' THEN
        concat(v_resource ->> 'election_id', ':', v_resource ->> 'member_id')
      WHEN v_resource ? 'tag_id' AND v_resource ? 'student_id' THEN
        concat(v_resource ->> 'tag_id', ':', v_resource ->> 'student_id')
      ELSE NULL
    END
  );

  -- Detalle: old/new segun operacion
  IF TG_OP = 'INSERT' THEN
    v_details := jsonb_build_object('new', to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    v_details := jsonb_build_object('old', to_jsonb(OLD));
  ELSE -- UPDATE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    -- Solo guardar campos que cambiaron. updated_at lo mueve el trigger de
    -- timestamp en cada guardado, asi que por si solo no cuenta como cambio:
    -- registrarlo dejaba eventos que la pantalla mostraba vacios.
    SELECT jsonb_object_agg(key, value)
    INTO v_details
    FROM jsonb_each(v_new)
    WHERE v_new -> key IS DISTINCT FROM v_old -> key
      AND key <> 'updated_at';

    IF v_details IS NULL THEN
      -- Nada cambio, no loguear
      IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END IF;

    v_details := jsonb_build_object('changes', v_details, 'previous', (
      SELECT jsonb_object_agg(key, v_old -> key)
      FROM jsonb_each(v_details)
    ));
  END IF;

  IF TG_ARGV[0] = 'admin' THEN
    SELECT s.full_name, s.carnet
    INTO v_target_name, v_target_carnet
    FROM students s
    WHERE s.id::TEXT = v_resource ->> 'students_id';

    v_details := COALESCE(v_details, '{}'::jsonb) || jsonb_strip_nulls(
      jsonb_build_object(
        'target_name', v_target_name,
        'target_carnet', v_target_carnet
      )
    );
  END IF;

  IF TG_ARGV[0] = 'election_option' THEN
    v_details := (
      (
        (
          (
            COALESCE(v_details, '{}'::jsonb)
            #- '{new,image_url}'
          )
          #- '{old,image_url}'
        )
        #- '{changes,image_url}'
      )
      #- '{previous,image_url}'
    );

    IF TG_OP = 'UPDATE'
       AND jsonb_typeof(COALESCE(v_details -> 'changes', '{}'::jsonb)) = 'object'
       AND COALESCE(v_details -> 'changes', '{}'::jsonb) = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  END IF;

  -- ==========================================================
  -- APPLICATIONS
  -- La bitacora es visible para cualquier admin, asi que nunca
  -- debe contener datos personales sensibles del postulante.
  -- Se eliminan de todas las ramas del detalle y se enriquece
  -- con el titulo del formulario. La identidad de la persona
  -- viaja aparte, resuelta contra el padron.
  -- ==========================================================
  IF TG_ARGV[0] = 'application' THEN
    DECLARE
      v_pii_fields TEXT[] := ARRAY[
        'national_id', 'phone', 'email', 'first_name', 'last_name_1', 'last_name_2'
      ];
      v_slot  TEXT;
      v_field TEXT;
    BEGIN
      v_details := COALESCE(v_details, '{}'::jsonb);

      FOREACH v_field IN ARRAY v_pii_fields LOOP
        FOREACH v_slot IN ARRAY ARRAY['new', 'old', 'changes', 'previous'] LOOP
          v_details := v_details #- ARRAY[v_slot, v_field];
        END LOOP;
      END LOOP;
    END;

    -- Si lo unico que cambio era PII, no queda nada que registrar.
    IF TG_OP = 'UPDATE'
       AND jsonb_typeof(COALESCE(v_details -> 'changes', '{}'::jsonb)) = 'object'
       AND COALESCE(v_details -> 'changes', '{}'::jsonb) = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    DECLARE
      v_form_title    TEXT;
      v_position_name TEXT;
      v_student_name  TEXT;
      v_student_carnet TEXT;
    BEGIN
      SELECT af.title INTO v_form_title
      FROM application_forms af
      WHERE af.id::TEXT = v_resource ->> 'form_id';

      SELECT ap.name INTO v_position_name
      FROM application_positions ap
      WHERE ap.id::TEXT = v_resource ->> 'position_id';

      SELECT s.full_name, s.carnet INTO v_student_name, v_student_carnet
      FROM students s
      WHERE s.id::TEXT = v_resource ->> 'student_id';

      v_details := COALESCE(v_details, '{}'::jsonb) || jsonb_strip_nulls(
        jsonb_build_object(
          'form_title', v_form_title,
          'position_name', v_position_name,
          'target_name', v_student_name,
          'target_carnet', v_student_carnet
        )
      );
    END;
  END IF;

  -- Titulo legible del formulario de postulacion
  IF TG_ARGV[0] = 'application_form' THEN
    v_details := COALESCE(v_details, '{}'::jsonb) || jsonb_strip_nulls(
      jsonb_build_object(
        'form_title', v_resource ->> 'title'
      )
    );
  END IF;

  -- Un puesto solo tiene sentido dentro de su convocatoria: sin el titulo
  -- del formulario el evento no le dice nada a quien lee la bitacora.
  IF TG_ARGV[0] = 'application_position' THEN
    DECLARE
      v_form_title TEXT;
    BEGIN
      SELECT af.title INTO v_form_title
      FROM application_forms af
      WHERE af.id::TEXT = v_resource ->> 'form_id';

      v_details := COALESCE(v_details, '{}'::jsonb) || jsonb_strip_nulls(
        jsonb_build_object(
          'form_title', v_form_title,
          'position_name', v_resource ->> 'name'
        )
      );
    END;
  END IF;

  -- Enriquecimiento para ELECTIONS: incluir titulo legible y, al cerrar, el conteo agregado
  IF TG_ARGV[0] = 'election' THEN
    v_details := COALESCE(v_details, '{}'::jsonb) || jsonb_strip_nulls(
      jsonb_build_object(
        'election_title', v_resource ->> 'title'
      )
    );

    IF TG_OP = 'UPDATE'
       AND (v_new ->> 'status') IS DISTINCT FROM (v_old ->> 'status')
       AND (v_new ->> 'status') = 'CLOSED' THEN
      DECLARE
        v_ballots_count BIGINT;
      BEGIN
        SELECT count(*) INTO v_ballots_count
        FROM election_voters
        WHERE election_id::TEXT = v_resource ->> 'id'
          AND token_used = true;

        v_details := v_details || jsonb_build_object('ballots_count', v_ballots_count);
      END;
    END IF;
  END IF;

  -- Enriquecimiento para SCRUTINY_KEYS: nombre de eleccion y titular de la llave
  IF TG_ARGV[0] = 'scrutiny_key' THEN
    DECLARE
      v_election_title TEXT;
      v_holder_name    TEXT;
      v_holder_carnet  TEXT;
    BEGIN
      SELECT e.title INTO v_election_title
      FROM elections e
      WHERE e.id::TEXT = v_resource ->> 'election_id';

      SELECT s.full_name, s.carnet INTO v_holder_name, v_holder_carnet
      FROM students s
      WHERE s.id::TEXT = v_resource ->> 'member_id';

      v_details := COALESCE(v_details, '{}'::jsonb) || jsonb_strip_nulls(
        jsonb_build_object(
          'election_title', v_election_title,
          'holder_name', v_holder_name,
          'holder_carnet', v_holder_carnet
        )
      );
    END;
  END IF;

  IF TG_ARGV[0] = 'tag_member' THEN
    SELECT t.name
    INTO v_tag_name
    FROM tags t
    WHERE t.id::TEXT = v_resource ->> 'tag_id';

    SELECT s.full_name, s.carnet
    INTO v_target_name, v_target_carnet
    FROM students s
    WHERE s.id::TEXT = v_resource ->> 'student_id';

    IF TG_OP = 'INSERT' THEN
      v_details := jsonb_set(
        COALESCE(v_details, '{}'::jsonb),
        '{new}',
        COALESCE(v_details -> 'new', '{}'::jsonb) || jsonb_strip_nulls(
          jsonb_build_object(
            'tag_name', v_tag_name,
            'student_name', v_target_name,
            'student_carnet', v_target_carnet
          )
        )
      );
    ELSIF TG_OP = 'DELETE' THEN
      v_details := jsonb_set(
        COALESCE(v_details, '{}'::jsonb),
        '{old}',
        COALESCE(v_details -> 'old', '{}'::jsonb) || jsonb_strip_nulls(
          jsonb_build_object(
            'tag_name', v_tag_name,
            'student_name', v_target_name,
            'student_carnet', v_target_carnet
          )
        )
      );
    END IF;

    v_details := COALESCE(v_details, '{}'::jsonb) || jsonb_strip_nulls(
      jsonb_build_object(
        'tag_name', v_tag_name,
        'target_name', v_target_name,
        'target_carnet', v_target_carnet
      )
    );
  END IF;

  INSERT INTO audit_logs (actor_id, actor_carnet, action, resource_type, resource_id, details, ip_address)
  VALUES (
    NULLIF(_audit_get('app.actor_id'), '')::UUID,
    NULLIF(_audit_get('app.actor_carnet'), ''),
    v_action,
    TG_ARGV[0],
    v_resource_id,
    v_details,
    NULLIF(_audit_get('app.client_ip'), '')
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

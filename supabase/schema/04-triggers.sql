-- ========================================================
-- SCRIPT 04: AUDIT LOG TRIGGERS
--
-- Toda accion relevante se registra automaticamente
-- via triggers, sin consumir requests de la API.
--
-- El backend puede (opcionalmente) setear variables
-- de sesion antes de operaciones para capturar contexto:
--   SET LOCAL app.actor_id = '<uuid>';
--   SET LOCAL app.actor_carnet = '<carnet>';
--   SET LOCAL app.client_ip = '<ip>';
-- ========================================================

-- Helper: lee variables de sesion sin error si no existen
CREATE OR REPLACE FUNCTION _audit_get(key TEXT) RETURNS TEXT AS $$
BEGIN
  RETURN current_setting(key, true);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- FUNCION GENERICA DE AUDITORIA
-- ============================================
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
    -- Solo guardar campos que cambiaron
    SELECT jsonb_object_agg(key, value)
    INTO v_details
    FROM jsonb_each(v_new)
    WHERE v_new -> key IS DISTINCT FROM v_old -> key;

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
        FROM votes
        WHERE election_id::TEXT = v_resource ->> 'id';

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

-- ============================================
-- TRIGGERS: STUDENTS (padrón)
-- ============================================
CREATE TRIGGER trg_students_insert
  AFTER INSERT ON students
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('student');

CREATE TRIGGER trg_students_update
  AFTER UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('student');

CREATE TRIGGER trg_students_delete
  AFTER DELETE ON students
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('student');

-- ============================================
-- TRIGGERS: ADMINS
-- ============================================
CREATE TRIGGER trg_admins_insert
  AFTER INSERT ON admins
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('admin');

CREATE TRIGGER trg_admins_update
  AFTER UPDATE ON admins
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('admin');

CREATE TRIGGER trg_admins_delete
  AFTER DELETE ON admins
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('admin');

-- ============================================
-- TRIGGERS: ELECTIONS
-- ============================================
CREATE TRIGGER trg_elections_insert
  AFTER INSERT ON elections
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('election');

CREATE TRIGGER trg_elections_update
  AFTER UPDATE ON elections
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('election');

CREATE TRIGGER trg_elections_delete
  AFTER DELETE ON elections
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('election');

-- ============================================
-- TRIGGERS: TAGS
-- ============================================
CREATE TRIGGER trg_tags_insert
  AFTER INSERT ON tags
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('tag');

CREATE TRIGGER trg_tags_update
  AFTER UPDATE ON tags
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('tag');

CREATE TRIGGER trg_tags_delete
  AFTER DELETE ON tags
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('tag');

CREATE TRIGGER trg_tag_members_insert
  AFTER INSERT ON tag_members
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('tag_member');

CREATE TRIGGER trg_tag_members_delete
  AFTER DELETE ON tag_members
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('tag_member');

-- ============================================
-- TRIGGERS: ELECTION_OPTIONS
-- ============================================
CREATE TRIGGER trg_election_options_insert
  AFTER INSERT ON election_options
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('election_option');

CREATE TRIGGER trg_election_options_update
  AFTER UPDATE ON election_options
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('election_option');

CREATE TRIGGER trg_election_options_delete
  AFTER DELETE ON election_options
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('election_option');

-- ============================================
-- PRIVACIDAD: NO se auditan eventos individuales de voto/canjeo
-- de token. Esos triggers fueron eliminados a proposito para
-- evitar trazabilidad de votantes. La auditoria solo expone el
-- conteo agregado al cerrar la eleccion (ver fn_audit_log para
-- 'election' con status CLOSED).
-- ============================================

-- ============================================
-- TRIGGERS: SCRUTINY_KEYS
-- ============================================
CREATE TRIGGER trg_scrutiny_keys_insert
  AFTER INSERT ON scrutiny_keys
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('scrutiny_key');

CREATE TRIGGER trg_scrutiny_keys_update
  AFTER UPDATE ON scrutiny_keys
  FOR EACH ROW
  WHEN (OLD.has_submitted IS DISTINCT FROM NEW.has_submitted)
  EXECUTE FUNCTION fn_audit_log('scrutiny_key');

-- ============================================
-- TRIGGERS: PADRON_UPLOADS
-- ============================================
CREATE TRIGGER trg_padron_uploads_insert
  AFTER INSERT ON padron_uploads
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('padron_upload');

-- ============================================
-- updated_at AUTO-UPDATE
-- ============================================
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_students_updated_at
  BEFORE UPDATE ON students
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_admins_updated_at
  BEFORE UPDATE ON admins
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_elections_updated_at
  BEFORE UPDATE ON elections
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

CREATE TRIGGER trg_tags_updated_at
  BEFORE UPDATE ON tags
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

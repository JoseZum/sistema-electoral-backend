-- =========================================================
-- MIGRACION: MODULO DE POSTULACIONES
--
-- Anade el sistema de formularios de postulacion:
--   * El admin crea formularios con ventana de tiempo y audiencia.
--   * Los estudiantes elegibles los llenan (datos + adjuntos PDF/imagen).
--   * El admin revisa y asigna APPROVED / CONDITIONED / REJECTED.
--   * En CONDITIONED solo se reabren los campos que el admin marque.
--
-- Los adjuntos se guardan como BYTEA dentro de Postgres para que el
-- comportamiento sea identico en local (docker-compose) y en Supabase,
-- sin depender de un bucket externo.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- =========================================================

-- ---------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'application_form_status') THEN
    CREATE TYPE application_form_status AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'ARCHIVED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'application_status') THEN
    CREATE TYPE application_status AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'CONDITIONED', 'REJECTED');
  END IF;
END
$$;

-- ---------------------------------------------------------
-- FORMULARIOS DE POSTULACION
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS application_forms (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title                 TEXT NOT NULL,
    description           TEXT,
    status                application_form_status NOT NULL DEFAULT 'DRAFT',
    start_time            TIMESTAMPTZ,
    end_time              TIMESTAMPTZ,
    -- "Otros PDF (opcional: el administrador elige si si o no)"
    allow_other_documents BOOLEAN NOT NULL DEFAULT false,
    other_documents_label TEXT,
    -- Audiencia: reutiliza el enum de elecciones (FULL_PADRON | FILTERED | MANUAL | TAG)
    voter_source          voter_source_type NOT NULL DEFAULT 'FULL_PADRON',
    voter_filter          JSONB,
    tag_id                UUID REFERENCES tags(id) ON DELETE SET NULL,
    -- Vinculo opcional con una votacion (para convertir aprobados en candidatos)
    election_id           UUID REFERENCES elections(id) ON DELETE SET NULL,
    created_by            UUID REFERENCES students(id),
    created_at            TIMESTAMPTZ DEFAULT now(),
    updated_at            TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_application_forms_window CHECK (
        start_time IS NULL OR end_time IS NULL OR end_time > start_time
    )
);

CREATE INDEX IF NOT EXISTS idx_application_forms_status     ON application_forms(status);
CREATE INDEX IF NOT EXISTS idx_application_forms_tag_id     ON application_forms(tag_id);
CREATE INDEX IF NOT EXISTS idx_application_forms_election   ON application_forms(election_id);

-- ---------------------------------------------------------
-- PADRON ELEGIBLE POR FORMULARIO (espejo de election_voters)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS application_form_eligibility (
    form_id    UUID NOT NULL REFERENCES application_forms(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    PRIMARY KEY (form_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_application_eligibility_student
    ON application_form_eligibility(student_id);

-- ---------------------------------------------------------
-- POSTULACIONES (respuesta del estudiante)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS applications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id             UUID NOT NULL REFERENCES application_forms(id) ON DELETE CASCADE,
    student_id          UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    status              application_status NOT NULL DEFAULT 'DRAFT',

    -- Informacion personal escrita
    last_name_1         TEXT,
    last_name_2         TEXT,
    first_name          TEXT,
    email               TEXT,
    national_id         TEXT,
    carnet              TEXT,
    phone               TEXT,

    -- Informacion seleccionable
    sede                TEXT,
    career              TEXT,

    -- Revision
    unlocked_fields     JSONB,
    correction_deadline TIMESTAMPTZ,
    review_comment      TEXT,
    reviewed_by         UUID REFERENCES students(id),
    reviewed_at         TIMESTAMPTZ,
    submitted_at        TIMESTAMPTZ,

    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT uniq_applications_form_student UNIQUE (form_id, student_id),
    -- "no guiones ni espacios" (el doc). NULL permitido mientras es borrador.
    CONSTRAINT chk_applications_national_id CHECK (national_id IS NULL OR national_id ~ '^[0-9]+$'),
    CONSTRAINT chk_applications_carnet      CHECK (carnet      IS NULL OR carnet      ~ '^[0-9]+$'),
    CONSTRAINT chk_applications_phone       CHECK (phone       IS NULL OR phone       ~ '^[0-9]+$'),
    CONSTRAINT chk_applications_unlocked_fields CHECK (
        unlocked_fields IS NULL OR jsonb_typeof(unlocked_fields) = 'array'
    )
);

CREATE INDEX IF NOT EXISTS idx_applications_form    ON applications(form_id);
CREATE INDEX IF NOT EXISTS idx_applications_student ON applications(student_id);
CREATE INDEX IF NOT EXISTS idx_applications_status  ON applications(status);

-- ---------------------------------------------------------
-- ADJUNTOS (PDF / imagen) guardados como BYTEA
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS application_files (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    field_key      TEXT NOT NULL CHECK (field_key IN (
                      'enrollment_report',  -- Informe de matricula
                      'id_copy',            -- Copia de la identificacion
                      'carnet_copy',        -- Copia del carne
                      'tdf_letter',         -- Carta de sanciones del TDF
                      'th_letter',          -- Carta de sanciones del TH
                      'other'               -- Otros PDF (opcional)
                    )),
    file_name      TEXT NOT NULL,
    mime_type      TEXT NOT NULL CHECK (mime_type IN (
                      'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
                    )),
    size_bytes     INT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 4194304), -- 4 MB
    content        BYTEA NOT NULL,
    uploaded_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_files_application
    ON application_files(application_id);

-- Los campos fijos admiten un unico archivo; 'other' admite varios.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_application_files_field
    ON application_files(application_id, field_key)
    WHERE field_key <> 'other';

-- ---------------------------------------------------------
-- HISTORIAL DE REVISIONES
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS application_reviews (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id      UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    reviewer_id         UUID REFERENCES students(id),
    decision            application_status NOT NULL CHECK (
                          decision IN ('APPROVED', 'CONDITIONED', 'REJECTED')
                        ),
    comment             TEXT,
    unlocked_fields     JSONB,
    correction_deadline TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_application_reviews_application
    ON application_reviews(application_id, created_at DESC);

-- =========================================================
-- AUDITORIA
--
-- fn_audit_log() es una unica funcion compartida por todos los
-- triggers, asi que hay que reemplazarla completa para anadir el
-- saneo de PII de 'application'. El cuerpo es identico al de
-- 04-triggers.sql salvo el bloque marcado como NUEVO.
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

  -- NUEVO: al crear un formulario de postulacion se puebla la elegibilidad
  -- en bloque; esos eventos son ruido igual que tag_member.
  IF TG_ARGV[0] = 'application_form' AND _audit_get('app.compound_application_mode') = 'true'
     AND TG_OP <> 'INSERT' THEN
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
  -- NUEVO: APPLICATIONS
  -- La bitacora es visible para cualquier admin, asi que nunca
  -- debe contener datos personales sensibles del postulante.
  -- Se elimina cedula y telefono de todas las ramas del detalle
  -- y se enriquece con el titulo del formulario.
  -- ==========================================================
  IF TG_ARGV[0] = 'application' THEN
    v_details := (
      (((((((
        COALESCE(v_details, '{}'::jsonb)
        #- '{new,national_id}') #- '{new,phone}')
        #- '{old,national_id}') #- '{old,phone}')
        #- '{changes,national_id}') #- '{changes,phone}')
        #- '{previous,national_id}') #- '{previous,phone}'
    );

    -- Si lo unico que cambio era PII, no queda nada que registrar.
    IF TG_OP = 'UPDATE'
       AND jsonb_typeof(COALESCE(v_details -> 'changes', '{}'::jsonb)) = 'object'
       AND COALESCE(v_details -> 'changes', '{}'::jsonb) = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    DECLARE
      v_form_title    TEXT;
      v_student_name  TEXT;
      v_student_carnet TEXT;
    BEGIN
      SELECT af.title INTO v_form_title
      FROM application_forms af
      WHERE af.id::TEXT = v_resource ->> 'form_id';

      SELECT s.full_name, s.carnet INTO v_student_name, v_student_carnet
      FROM students s
      WHERE s.id::TEXT = v_resource ->> 'student_id';

      v_details := COALESCE(v_details, '{}'::jsonb) || jsonb_strip_nulls(
        jsonb_build_object(
          'form_title', v_form_title,
          'target_name', v_student_name,
          'target_carnet', v_student_carnet
        )
      );
    END;
  END IF;

  -- NUEVO: titulo legible del formulario de postulacion
  IF TG_ARGV[0] = 'application_form' THEN
    v_details := COALESCE(v_details, '{}'::jsonb) || jsonb_strip_nulls(
      jsonb_build_object(
        'form_title', v_resource ->> 'title'
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

-- ---------------------------------------------------------
-- TRIGGERS: APPLICATION_FORMS
-- ---------------------------------------------------------
DROP TRIGGER IF EXISTS trg_application_forms_insert ON application_forms;
CREATE TRIGGER trg_application_forms_insert
  AFTER INSERT ON application_forms
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('application_form');

DROP TRIGGER IF EXISTS trg_application_forms_update ON application_forms;
CREATE TRIGGER trg_application_forms_update
  AFTER UPDATE ON application_forms
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('application_form');

DROP TRIGGER IF EXISTS trg_application_forms_delete ON application_forms;
CREATE TRIGGER trg_application_forms_delete
  AFTER DELETE ON application_forms
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('application_form');

-- ---------------------------------------------------------
-- TRIGGERS: APPLICATIONS
--
-- Solo se auditan los cambios de estado (envio y resolucion).
-- El tecleo de un borrador no es un evento de interes y ademas
-- llenaria la bitacora de datos personales.
-- ---------------------------------------------------------
DROP TRIGGER IF EXISTS trg_applications_update ON applications;
CREATE TRIGGER trg_applications_update
  AFTER UPDATE ON applications
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION fn_audit_log('application');

DROP TRIGGER IF EXISTS trg_applications_delete ON applications;
CREATE TRIGGER trg_applications_delete
  AFTER DELETE ON applications
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('application');

-- ---------------------------------------------------------
-- SIN TRIGGER en application_files (la columna content reventaria
-- audit_logs) ni en application_form_eligibility (ruido masivo,
-- mismo criterio que election_voters).
-- ---------------------------------------------------------

-- ---------------------------------------------------------
-- updated_at AUTO-UPDATE
-- ---------------------------------------------------------
DROP TRIGGER IF EXISTS trg_application_forms_updated_at ON application_forms;
CREATE TRIGGER trg_application_forms_updated_at
  BEFORE UPDATE ON application_forms
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_applications_updated_at ON applications;
CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- =========================================================
-- MIGRACION: PUESTOS DE POSTULACION
--
-- Cada formulario puede definir N puestos (solo nombre) y el postulante
-- elige a cual se presenta al enviar su postulacion.
--
-- El administrador puede anadir, renombrar y quitar puestos en cualquier
-- momento, incluso con el formulario ya abierto y con respuestas dentro.
--
-- Idempotente: se puede correr varias veces sin romper nada.
-- =========================================================

CREATE TABLE IF NOT EXISTS application_positions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id       UUID NOT NULL REFERENCES application_forms(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    display_order INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_application_positions_name CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS idx_application_positions_form
    ON application_positions(form_id, display_order);

-- Dos puestos con el mismo nombre dentro de un formulario no se pueden
-- distinguir en el desplegable del postulante.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_application_positions_name
    ON application_positions(form_id, lower(btrim(name)));

-- La columna es nullable a proposito: las postulaciones que ya existen no
-- tienen puesto, y un formulario puede no definir ninguno. La obligatoriedad
-- se valida al enviar, y solo si el formulario tiene puestos definidos.
--
-- ON DELETE RESTRICT protege el dato historico: si alguien ya se postulo a un
-- puesto, borrarlo falla y el servicio lo traduce a un error explicativo en
-- vez de dejar postulaciones sin destino.
ALTER TABLE applications
    ADD COLUMN IF NOT EXISTS position_id UUID REFERENCES application_positions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_applications_position ON applications(position_id);

-- ---------------------------------------------------------
-- AUDITORIA
-- ---------------------------------------------------------
DROP TRIGGER IF EXISTS trg_application_positions_insert ON application_positions;
CREATE TRIGGER trg_application_positions_insert
  AFTER INSERT ON application_positions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('application_position');

DROP TRIGGER IF EXISTS trg_application_positions_update ON application_positions;
CREATE TRIGGER trg_application_positions_update
  AFTER UPDATE ON application_positions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('application_position');

DROP TRIGGER IF EXISTS trg_application_positions_delete ON application_positions;
CREATE TRIGGER trg_application_positions_delete
  AFTER DELETE ON application_positions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_log('application_position');

DROP TRIGGER IF EXISTS trg_application_positions_updated_at ON application_positions;
CREATE TRIGGER trg_application_positions_updated_at
  BEFORE UPDATE ON application_positions
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ---------------------------------------------------------
-- BLINDAJE
--
-- Mismo criterio que el resto del modulo: los privilegios por defecto del
-- esquema public otorgan todo a anon y authenticated en cualquier tabla
-- nueva, asi que se cierra el acceso desde PostgREST. El backend conecta
-- por Postgres directo y no se ve afectado.
-- ---------------------------------------------------------
ALTER TABLE application_positions ENABLE ROW LEVEL SECURITY;

-- Los roles anon y authenticated solo existen en Supabase; en el Postgres
-- local del docker-compose no estan, asi que el REVOKE se hace condicional
-- para que la misma migracion sirva en los dos entornos.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON application_positions FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON application_positions FROM authenticated;
  END IF;
END
$$;

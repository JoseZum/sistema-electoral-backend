-- =============================================================================
-- Anonimato del voto: cerrar la reconstruccion del vinculo votante-papeleta
-- =============================================================================
-- El ultimo paso de los procedimientos anonimos pone token_hash y
-- token_encrypted en NULL para destruir el puente entre identidad y papeleta.
-- Ese borrado no bastaba: quedaban dos vias para reconstruirlo.
--
-- CANAL 1 - marca temporal
--   Los procedimientos escribian el mismo now() en tres sitios de la misma
--   transaccion: votes.created_at (DEFAULT now()), voting_tokens.used_at y
--   election_voters.token_used_at. En PostgreSQL now() es
--   transaction_timestamp() y no avanza dentro de la transaccion, asi que los
--   tres quedaban identicos al microsegundo. Como cada voto es su propia
--   transaccion, cada votante recibia una marca unica y un JOIN por timestamp
--   emparejaba persona con papeleta 1 a 1.
--
--   Correccion: date_trunc('day', now()) del lado identidad (todos los votantes
--   de la jornada comparten valor, poder de correlacion cero, se mantiene
--   NOT NULL) y date_trunc('hour', now()) del lado papeleta, que ademas evita
--   el cruce contra registros externos de peticiones.
--
-- CANAL 2 - orden fisico de fila (ctid)
--   Cada voto inserta en votes y actualiza voting_tokens. Por MVCC el UPDATE
--   reescribe la fila, de modo que el ctid de ambas tablas seguia el orden de
--   votacion. Correlacionando por ranking de ctid se reconstruian los votos
--   aunque ninguna columna los relacionara. Verificado: 10 de 10 aciertos.
--
--   Correccion: fn_shuffle_election_votes reescribe las papeletas de la
--   eleccion en orden fisico aleatorio, y un trigger la dispara al pasar a
--   CLOSED. Es el equivalente a agitar la urna antes del escrutinio.
--   Tras aplicarlo los aciertos por ctid caen al nivel del azar.
--
-- Los procedimientos *_named no se tocan: ahi la correspondencia persona-voto
-- es el comportamiento buscado.
--
-- Nota: durante la votacion abierta el ctid sigue reflejando el orden. Eso
-- exige acceso de lectura a la base de datos mientras la urna esta abierta,
-- que es el mismo supuesto del limite ya documentado sobre voting_tokens.
-- El barajado cierra la exposicion permanente, que es la que importa.
--
-- Verificacion posterior (las tres deben dar 0 sobre elecciones votadas por
-- los procedimientos; el seed de desarrollo inserta filas a mano y no aplica):
--   SELECT count(*) FROM election_voters ev JOIN votes v
--     ON v.election_id = ev.election_id AND v.created_at = ev.token_used_at;
--   SELECT count(*) FROM voting_tokens vt JOIN votes v
--     ON v.election_id = vt.election_id AND v.created_at = vt.used_at;
--   SELECT count(*) FROM voting_tokens
--    WHERE used = true AND token_hash IS NOT NULL;
-- =============================================================================

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
    v_election_record RECORD;
    v_now TIMESTAMPTZ := now();
BEGIN
    -- Bloquea contra cambios de estado concurrentes sin serializar votos entre si.
    SELECT status, allow_suboptions INTO v_election_record
    FROM elections
    WHERE id = p_election_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Eleccion no encontrada';
    END IF;

    IF v_election_record.status <> 'OPEN' THEN
        RAISE EXCEPTION 'La votacion no esta abierta';
    END IF;

    IF v_election_record.allow_suboptions THEN
        RAISE EXCEPTION 'La eleccion requiere votos por subopciones';
    END IF;

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
        WHERE id = p_option_id
          AND election_id = p_election_id
          AND parent_option_id IS NULL
    ) THEN
        RAISE EXCEPTION 'Opción no pertenece a esta elección';
    END IF;

    -- Inserta el voto anonimo usando token_hash (sin student_id).
    -- created_at se trunca a la hora para que no pueda cruzarse contra los
    -- registros externos de peticiones (logs del proveedor), que si llevan identidad.
    INSERT INTO votes(election_id, option_id, token_hash, created_at)
    VALUES (p_election_id, p_option_id, p_token_hash, date_trunc('hour', v_now));

    -- Marca el token como utilizado para impedir reutilizacion.
    UPDATE voting_tokens
    -- Se trunca al dia: la hora exacta identificaria al votante al cruzarla
    -- contra votes.created_at, que se escribe en esta misma transaccion.
    SET used = true,
        used_at = date_trunc('day', v_now)
    WHERE election_id = p_election_id
      AND student_id = v_token_record.student_id;

    -- Marca al votante como participante en election_voters.
    UPDATE election_voters
    -- Truncado al dia por la misma razon que voting_tokens.used_at.
    SET token_used = true,
        token_used_at = date_trunc('day', v_now)
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

CREATE OR REPLACE FUNCTION fn_cast_suboption_votes_anonymous(
    p_election_id UUID,
    p_votes JSONB,
    p_token_hash TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_token_record RECORD;
    v_election_record RECORD;
    v_now TIMESTAMPTZ := now();
    v_expected_parent_count INT;
    v_payload_count INT;
    v_distinct_parent_count INT;
    v_invalid_selection BOOLEAN;
BEGIN
    SELECT status, allow_suboptions INTO v_election_record
    FROM elections
    WHERE id = p_election_id
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Eleccion no encontrada';
    END IF;

    IF v_election_record.status <> 'OPEN' THEN
        RAISE EXCEPTION 'La votacion no esta abierta';
    END IF;

    IF NOT v_election_record.allow_suboptions THEN
        RAISE EXCEPTION 'La eleccion no permite subopciones';
    END IF;

    IF p_votes IS NULL OR jsonb_typeof(p_votes) <> 'array' THEN
        RAISE EXCEPTION 'Selecciones de subopciones invalidas';
    END IF;

    SELECT * INTO v_token_record
    FROM voting_tokens
    WHERE election_id = p_election_id
      AND token_hash = p_token_hash
      AND used = false
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Token invÃ¡lido o ya utilizado';
    END IF;

    SELECT COUNT(*) INTO v_expected_parent_count
    FROM election_options
    WHERE election_id = p_election_id
      AND parent_option_id IS NULL;

    WITH payload AS (
        SELECT
            NULLIF(item->>'parentOptionId', '')::uuid AS parent_option_id,
            NULLIF(item->>'optionId', '')::uuid AS option_id
        FROM jsonb_array_elements(p_votes) item
    )
    SELECT COUNT(*), COUNT(DISTINCT parent_option_id)
    INTO v_payload_count, v_distinct_parent_count
    FROM payload;

    IF v_expected_parent_count = 0
       OR v_payload_count <> v_expected_parent_count
       OR v_distinct_parent_count <> v_expected_parent_count THEN
        RAISE EXCEPTION 'Debe seleccionar una subopcion por cada opcion';
    END IF;

    WITH payload AS (
        SELECT
            NULLIF(item->>'parentOptionId', '')::uuid AS parent_option_id,
            NULLIF(item->>'optionId', '')::uuid AS option_id
        FROM jsonb_array_elements(p_votes) item
    )
    SELECT EXISTS (
        SELECT 1
        FROM payload p
        LEFT JOIN election_options parent
          ON parent.id = p.parent_option_id
         AND parent.election_id = p_election_id
         AND parent.parent_option_id IS NULL
        LEFT JOIN election_options child
          ON child.id = p.option_id
         AND child.election_id = p_election_id
         AND child.parent_option_id = p.parent_option_id
        WHERE parent.id IS NULL OR child.id IS NULL
    )
    INTO v_invalid_selection;

    IF v_invalid_selection THEN
        RAISE EXCEPTION 'Subopcion no pertenece a esta eleccion';
    END IF;

    WITH payload AS (
        SELECT
            NULLIF(item->>'parentOptionId', '')::uuid AS parent_option_id,
            NULLIF(item->>'optionId', '')::uuid AS option_id
        FROM jsonb_array_elements(p_votes) item
    )
    -- created_at truncado a la hora: ver la nota de fn_cast_vote_anonymous.
    INSERT INTO votes(election_id, parent_option_id, option_id, token_hash, created_at)
    SELECT p_election_id, parent_option_id, option_id, p_token_hash, date_trunc('hour', v_now)
    FROM payload;

    UPDATE voting_tokens
    -- Se trunca al dia: la hora exacta identificaria al votante al cruzarla
    -- contra votes.created_at, que se escribe en esta misma transaccion.
    SET used = true,
        used_at = date_trunc('day', v_now)
    WHERE election_id = p_election_id
      AND student_id = v_token_record.student_id;

    UPDATE election_voters
    -- Truncado al dia por la misma razon que voting_tokens.used_at.
    SET token_used = true,
        token_used_at = date_trunc('day', v_now)
    WHERE election_id = p_election_id
      AND student_id = v_token_record.student_id;

    UPDATE voting_tokens
    SET token_hash = NULL,
        token_encrypted = NULL
    WHERE election_id = p_election_id
      AND student_id = v_token_record.student_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_shuffle_election_votes(p_election_id UUID)
RETURNS INT
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
    v_rows votes[];
    v_count INT;
BEGIN
    SELECT array_agg(v ORDER BY random()) INTO v_rows
    FROM votes v
    WHERE v.election_id = p_election_id;

    IF v_rows IS NULL THEN
        RETURN 0;
    END IF;

    DELETE FROM votes WHERE election_id = p_election_id;

    INSERT INTO votes
    SELECT (unnest(v_rows)).*;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION fn_elections_shuffle_on_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.is_anonymous
       AND NEW.status = 'CLOSED'
       AND OLD.status IS DISTINCT FROM 'CLOSED' THEN
        PERFORM fn_shuffle_election_votes(NEW.id);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_elections_shuffle_votes ON elections;
CREATE TRIGGER trg_elections_shuffle_votes
  AFTER UPDATE ON elections
  FOR EACH ROW EXECUTE FUNCTION fn_elections_shuffle_on_close();

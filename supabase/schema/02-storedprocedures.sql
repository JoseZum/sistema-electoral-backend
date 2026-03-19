-- Cast anonymous vote using token
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
    -- Verify token exists and hasn't been used
    SELECT * INTO v_token_record
    FROM voting_tokens
    WHERE election_id = p_election_id
      AND token_hash = p_token_hash
      AND used = false
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Token inválido o ya utilizado';
    END IF;

    -- Verify option belongs to election
    IF NOT EXISTS (
        SELECT 1 FROM election_options
        WHERE id = p_option_id AND election_id = p_election_id
    ) THEN
        RAISE EXCEPTION 'Opción no pertenece a esta elección';
    END IF;

    -- Insert vote
    INSERT INTO votes(election_id, option_id, token_hash)
    VALUES (p_election_id, p_option_id, p_token_hash);

    -- Mark token as used
    UPDATE voting_tokens
    SET used = true,
        used_at = v_now
    WHERE election_id = p_election_id
      AND student_id = v_token_record.student_id;

    -- Mark voter as having voted
    UPDATE election_voters
    SET token_used = true,
        token_used_at = v_now
    WHERE election_id = p_election_id
      AND student_id = v_token_record.student_id;

    -- Destroy traceability: remove short/long token material from the access table
    UPDATE voting_tokens
    SET code_hash = NULL,
        token_hash = NULL,
        token_encrypted = NULL
    WHERE election_id = p_election_id
      AND student_id = v_token_record.student_id;
END;
$$;

-- Cast non-anonymous vote directly with student identity
CREATE OR REPLACE FUNCTION fn_cast_vote_named(
    p_election_id UUID,
    p_option_id UUID,
    p_student_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    -- Verify voter is eligible
    IF NOT EXISTS (
        SELECT 1 FROM election_voters
        WHERE election_id = p_election_id
          AND student_id = p_student_id
    ) THEN
        RAISE EXCEPTION 'Votante no es elegible para esta elección';
    END IF;

    -- Verify option belongs to election
    IF NOT EXISTS (
        SELECT 1 FROM election_options
        WHERE id = p_option_id AND election_id = p_election_id
    ) THEN
        RAISE EXCEPTION 'Opción no pertenece a esta elección';
    END IF;

    -- Insert vote (UNIQUE constraint prevents double voting)
    INSERT INTO votes(election_id, option_id, student_id)
    VALUES (p_election_id, p_option_id, p_student_id);

    -- Mark voter as having voted
    UPDATE election_voters
    SET token_used = true, token_used_at = now()
    WHERE election_id = p_election_id
      AND student_id = p_student_id;
END;
$$;

-- Import padron with full diff: upsert new/existing, deactivate missing, reactivate returning
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
    -- Get actor info from session
    v_actor_carnet := current_setting('app.actor_carnet', true);

    -- Set bulk import flag so student triggers skip individual logging
    PERFORM set_config('app.bulk_import', 'true', true);

    -- Collect all valid carnets from the incoming data
    SELECT array_agg(NULLIF(trim(x->>'Carnet'), ''))
    INTO v_incoming_carnets
    FROM jsonb_array_elements(p_data) x
    WHERE NULLIF(trim(x->>'Carnet'), '') IS NOT NULL
      AND NULLIF(trim(x->>'Nombre'), '') IS NOT NULL
      AND NULLIF(trim(x->>'Correo'), '') IS NOT NULL;

    v_total := coalesce(array_length(v_incoming_carnets, 1), 0);

    IF v_total = 0 THEN
        RETURN jsonb_build_object(
            'total', 0, 'new', 0, 'updated', 0,
            'reactivated', 0, 'deactivated', 0
        );
    END IF;

    -- Count how many are truly new (carnet not in DB at all)
    SELECT count(*) INTO v_new
    FROM unnest(v_incoming_carnets) c
    WHERE NOT EXISTS (SELECT 1 FROM students s WHERE s.carnet = c);

    -- Count reactivated (carnet exists but is_active = false)
    SELECT count(*) INTO v_reactivated
    FROM unnest(v_incoming_carnets) c
    JOIN students s ON s.carnet = c
    WHERE s.is_active = false;

    -- Upsert all incoming students + reactivate if they were inactive
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

    -- Updated = total - new - reactivated (those that existed and were already active)
    v_updated := v_total - v_new - v_reactivated;

    -- Deactivate students whose carnet is NOT in the new padron (and are currently active)
    WITH deactivated AS (
        UPDATE students
        SET is_active = false, updated_at = NOW()
        WHERE is_active = true
          AND carnet != ALL(v_incoming_carnets)
        RETURNING id
    )
    SELECT count(*) INTO v_deactivated FROM deactivated;

    -- Log ONE summary entry for the entire import
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

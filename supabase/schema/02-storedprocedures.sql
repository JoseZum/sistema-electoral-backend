CREATE OR REPLACE PROCEDURE cast_vote (
    p_election_id UUID,
    p_option_id UUID,
    p_voter_id UUID DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO votes(election_id, option_id, voter_id)
    VALUES (p_election_id, p_option_id, p_voter_id);
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
BEGIN
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

    RETURN jsonb_build_object(
        'total', v_total,
        'new', v_new,
        'updated', v_updated,
        'reactivated', v_reactivated,
        'deactivated', v_deactivated
    );
END;
$$;

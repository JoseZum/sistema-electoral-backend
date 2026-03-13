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

CREATE OR REPLACE PROCEDURE import_students(p_data jsonb)
LANGUAGE plpgsql
AS $$
BEGIN

INSERT INTO students (
    carnet,
    full_name,
    email,
    sede,
    career,
    degree_level
)
SELECT
    NULLIF(trim(x->>'Carnet'), ''),
    NULLIF(trim(x->>'Nombre'), ''),
    NULLIF(trim(x->>'Correo'), ''),
    NULLIF(trim(x->>'Sede'), ''),
    NULLIF(trim(x->>'Carrera'), ''),
    COALESCE(NULLIF(trim(x->>'Grado'), ''), 'NO_ESPECIFICADO')
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
    updated_at = NOW();

END;
$$;


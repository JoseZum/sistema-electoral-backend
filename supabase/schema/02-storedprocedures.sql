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
    x->>'Carnet',
    x->>'Nombre',
    x->>'Correo',
    x->>'Sede',
    x->>'Carrera',
    x->>'Grado'
FROM jsonb_array_elements(p_data) x
WHERE x->>'Carnet' IS NOT NULL;

END;
$$;


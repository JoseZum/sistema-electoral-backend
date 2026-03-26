-- Seed: admin user j.zumbado.1@estudiantec.cr
INSERT INTO students (carnet, full_name, email, sede, career, degree_level)
VALUES ('2024080534', 'Jose Fabian Zumbado Ruiz', 'j.zumbado.1@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato')
ON CONFLICT (email) DO NOTHING;

INSERT INTO admins (students_id, position_title, role, permissions)
SELECT id, 'Administrador', 'admin', '{"all": true}'::jsonb
FROM students WHERE email = 'j.zumbado.1@estudiantec.cr'
ON CONFLICT DO NOTHING;

INSERT INTO students (carnet, full_name, email, sede, career, degree_level)
VALUES ('2022104933', 'Fabricio Picado Alvarado', 'fpicado@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato')
ON CONFLICT (email) DO NOTHING;

INSERT INTO admins (students_id, position_title, role, permissions)
SELECT id, 'Administrador', 'admin', '{"all": true}'::jsonb
FROM students WHERE email = 'fpicado@estudiantec.cr'
ON CONFLICT DO NOTHING;

-- ============================================
-- SEED: ELECCIONES
-- ============================================

-- Elección 1: Representantes Estudiantiles
INSERT INTO elections (
    title,
    description,
    status,
    is_anonymous,
    auth_method,
    voter_source,
    voter_filter,
    requires_keys,
    min_keys,
    start_time,
    end_time,
    created_by
)
SELECT
    'Elección Representantes Estudiantiles 2026',
    'Elección de representantes estudiantiles por carrera',
    'SCHEDULED',
    true,
    'MICROSOFT',
    'FILTERED',
    '{"career": "Ingenieria en Computacion"}'::jsonb,
    false,
    3,
    now() + interval '1 day',
    now() + interval '2 days',
    id
FROM students
WHERE email = 'j.zumbado.1@estudiantec.cr'
ON CONFLICT DO NOTHING;


-- Elección 2: Referéndum Estudiantil
INSERT INTO elections (
    title,
    description,
    status,
    is_anonymous,
    auth_method,
    voter_source,
    voter_filter,
    requires_keys,
    min_keys,
    start_time,
    end_time,
    created_by
)
SELECT
    'Referéndum Estudiantil 2026',
    'Consulta sobre cambios en reglamento estudiantil',
    'DRAFT',
    true,
    'EMAIL_TOKEN',
    'FULL_PADRON',
    NULL,
    true,
    5,
    now() + interval '3 days',
    now() + interval '4 days',
    id
FROM students
WHERE email = 'fpicado@estudiantec.cr'
ON CONFLICT DO NOTHING;

-- ============================================
-- SEED: VOTANTES POR ELECCION
-- ============================================

-- Agregar estudiantes a "Elección Representantes Estudiantiles 2026"
INSERT INTO election_voters (election_id, student_id)
SELECT e.id, s.id
FROM elections e
JOIN students s ON s.email IN (
    'j.zumbado.1@estudiantec.cr',
    'fpicado@estudiantec.cr'
)
WHERE e.title = 'Elección Representantes Estudiantiles 2026'
ON CONFLICT DO NOTHING;


-- Agregar estudiantes a "Referéndum Estudiantil 2026"
INSERT INTO election_voters (election_id, student_id)
SELECT e.id, s.id
FROM elections e
JOIN students s ON s.email IN (
    'j.zumbado.1@estudiantec.cr',
    'fpicado@estudiantec.cr'
)
WHERE e.title = 'Referéndum Estudiantil 2026'
ON CONFLICT DO NOTHING;
-- ============================================
-- LIMPIAR TODO (IMPORTANTE)
-- ============================================

TRUNCATE votes, election_voters, election_options, elections RESTART IDENTITY CASCADE;

-- ============================================
-- USUARIOS BASE
-- ============================================

INSERT INTO students (carnet, full_name, email, sede, career, degree_level)
VALUES 
('2024080534', 'Jose Fabian Zumbado Ruiz', 'j.zumbado.1@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato'),
('2022104933', 'Fabricio Picado Alvarado', 'fpicado@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato'),
('9999999999', 'Fabricio Test Gmail', 'fabripicado@gmail.com', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato')
ON CONFLICT (email) DO NOTHING;

INSERT INTO admins (students_id, position_title, role, permissions)
SELECT id, 'Administrador', 'admin', '{"all": true}'::jsonb
FROM students 
WHERE email IN ('j.zumbado.1@estudiantec.cr', 'fpicado@estudiantec.cr')
ON CONFLICT DO NOTHING;

-- ============================================
-- MÁS ESTUDIANTES
-- ============================================

INSERT INTO students (carnet, full_name, email, sede, career, degree_level)
VALUES
('2023000001', 'Ana Perez', 'ana1@estudiantec.cr', 'San Jose', 'Ingenieria en Computacion', 'Bachillerato'),
('2023000002', 'Luis Gomez', 'luis2@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato'),
('2023000003', 'Maria Lopez', 'maria3@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato'),
('2023000004', 'Carlos Ruiz', 'carlos4@estudiantec.cr', 'Limon', 'Ingenieria en Computacion', 'Bachillerato'),
('2023000005', 'Sofia Vargas', 'sofia5@estudiantec.cr', 'San Jose', 'Ingenieria en Computacion', 'Bachillerato'),
('2023000006', 'Diego Castro', 'diego6@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato'),
('2023000007', 'Elena Mora', 'elena7@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato'),
('2023000008', 'Jorge Salas', 'jorge8@estudiantec.cr', 'Limon', 'Ingenieria en Computacion', 'Bachillerato')
ON CONFLICT (email) DO NOTHING;

-- ============================================
-- ELECCIÓN 1 (NO ANÓNIMA)
-- ============================================

INSERT INTO elections (
    title, description, status, is_anonymous,
    auth_method, voter_source, voter_filter,
    requires_keys, min_keys, start_time, end_time, created_by
)
SELECT
    'Elección Representantes Estudiantiles 2026',
    'Elección de representantes estudiantiles',
    'OPEN',
    false, -- 👈 NO ANÓNIMA
    'MICROSOFT',
    'FILTERED',
    '{"career": "Ingenieria en Computacion"}'::jsonb,
    false,
    3,
    now() - interval '1 day',
    now() + interval '1 day',
    id
FROM students
WHERE email = 'j.zumbado.1@estudiantec.cr';

-- Opciones
INSERT INTO election_options (election_id, label, option_type, display_order)
SELECT id, 'Candidato A', 'candidate', 1
FROM elections WHERE title = 'Elección Representantes Estudiantiles 2026';

INSERT INTO election_options (election_id, label, option_type, display_order)
SELECT id, 'Candidato B', 'candidate', 2
FROM elections WHERE title = 'Elección Representantes Estudiantiles 2026';

-- Votantes
INSERT INTO election_voters (election_id, student_id)
SELECT e.id, s.id
FROM elections e
JOIN students s ON s.career = 'Ingenieria en Computacion'
WHERE e.title = 'Elección Representantes Estudiantiles 2026';

-- Marcar votos (85%) con horas distribuidas
UPDATE election_voters ev
SET 
    token_used = true,
    token_used_at = now()
        - (floor(random() * 24) * interval '1 hour')
        - (floor(random() * 60) * interval '1 minute')
FROM elections e
WHERE ev.election_id = e.id
AND e.title = 'Elección Representantes Estudiantiles 2026'
AND random() > 0.15;

-- Insertar votos (NO ANÓNIMA → usa student_id)
INSERT INTO votes (election_id, option_id, student_id, created_at)
SELECT 
    ev.election_id,
    o.id,
    ev.student_id,
    ev.token_used_at
FROM election_voters ev
JOIN students s ON s.id = ev.student_id
JOIN election_options o ON o.election_id = ev.election_id
WHERE ev.token_used = true
AND ev.token_used_at IS NOT NULL
AND ev.election_id = (
    SELECT id FROM elections 
    WHERE title = 'Elección Representantes Estudiantiles 2026'
)
AND (
    (s.carnet::int % 2 = 0 AND o.label = 'Candidato A') OR
    (s.carnet::int % 2 != 0 AND o.label = 'Candidato B')
);

-- ============================================
-- ELECCIÓN 2 (ANÓNIMA)
-- ============================================

INSERT INTO elections (
    title, description, status, is_anonymous,
    auth_method, voter_source, voter_filter,
    requires_keys, min_keys, start_time, end_time, created_by
)
SELECT
    'Referéndum Estudiantil 2026',
    'Consulta sobre cambios en reglamento estudiantil',
    'OPEN',
    true, -- 👈 ANÓNIMA
    'EMAIL_TOKEN',
    'FULL_PADRON',
    NULL,
    true,
    5,
    now() - interval '2 days',
    now() + interval '2 days',
    id
FROM students
WHERE email = 'fpicado@estudiantec.cr';

-- Opciones
INSERT INTO election_options (election_id, label, option_type, display_order)
SELECT id, 'Sí', 'option', 1
FROM elections WHERE title = 'Referéndum Estudiantil 2026';

INSERT INTO election_options (election_id, label, option_type, display_order)
SELECT id, 'No', 'option', 2
FROM elections WHERE title = 'Referéndum Estudiantil 2026';

-- Votantes
INSERT INTO election_voters (election_id, student_id)
SELECT e.id, s.id
FROM elections e
JOIN students s ON true
WHERE e.title = 'Referéndum Estudiantil 2026';

-- Marcar votos (60%)
UPDATE election_voters ev
SET 
    token_used = true,
    token_used_at = now()
        - (floor(random() * 48) * interval '1 hour')
        - (floor(random() * 60) * interval '1 minute')
FROM elections e
WHERE ev.election_id = e.id
AND e.title = 'Referéndum Estudiantil 2026'
AND random() > 0.4;

-- Insertar votos (ANÓNIMA → usa token_hash)
INSERT INTO votes (election_id, option_id, token_hash, created_at)
SELECT 
    ev.election_id,
    o.id,
    md5(random()::text || clock_timestamp()::text), -- 👈 genera token único
    ev.token_used_at
FROM election_voters ev
JOIN election_options o ON o.election_id = ev.election_id
WHERE ev.token_used = true
AND ev.token_used_at IS NOT NULL
AND ev.election_id = (
    SELECT id FROM elections 
    WHERE title = 'Referéndum Estudiantil 2026'
)
AND (
    (random() > 0.5 AND o.label = 'Sí') OR
    (random() <= 0.5 AND o.label = 'No')
);
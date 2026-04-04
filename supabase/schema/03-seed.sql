-- ============================================
-- STUDENTS
-- ============================================
INSERT INTO students (carnet, full_name, email, sede, career, degree_level)
VALUES 
('2024080534', 'Jose Fabian Zumbado Ruiz', 'j.zumbado.1@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato'),
('2022104933', 'Fabricio Picado Alvarado', 'fpicado@estudiantec.cr', 'San Jose', 'Ingenieria en Computacion', 'Bachillerato'),
('2023101111', 'Maria Gonzalez Lopez', 'm.gonzalez@estudiantec.cr', 'San Jose', 'Ingenieria en Computacion', 'Bachillerato'),
('2023102222', 'Carlos Ramirez Mora', 'c.ramirez@estudiantec.cr', 'Limon', 'Ingenieria en Computacion', 'Bachillerato'),
('2023103333', 'Andrea Vargas Soto', 'a.vargas@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato'),
('2023104444', 'Luis Hernandez Rojas', 'l.hernandez@estudiantec.cr', 'San Carlos', 'Ingenieria en Computacion', 'Bachillerato'),
('2023105555', 'Sofia Castillo Perez', 's.castillo@estudiantec.cr', 'Alajuela', 'Ingenieria en Computacion', 'Bachillerato'),
('2023106666', 'Daniel Torres Quesada', 'd.torres@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato')
ON CONFLICT (email) DO NOTHING;

-- ============================================
-- ADMINS
-- ============================================
INSERT INTO admins (students_id, position_title, role, permissions)
SELECT id, 'Administrador', 'admin', '{"all": true}'::jsonb
FROM students 
WHERE email IN ('j.zumbado.1@estudiantec.cr', 'fpicado@estudiantec.cr')
ON CONFLICT DO NOTHING;

-- ============================================
-- ELECCIONES
-- ============================================
INSERT INTO elections (title, description, status, is_anonymous, auth_method, voter_source, start_time, end_time, created_by)
VALUES
(
    'Eleccion 2026',
    'Eleccion general',
    'OPEN',
    false,
    'MICROSOFT',
    'FULL_PADRON',
    now() - interval '3 days',
    now() + interval '1 day',
    (SELECT id FROM students WHERE email = 'j.zumbado.1@estudiantec.cr')
),
(
    'Encuesta Cafeteria',
    'Encuesta general',
    'OPEN',
    true,
    'MICROSOFT',
    'FULL_PADRON',
    now() - interval '4 days',
    now() + interval '12 hours',
    (SELECT id FROM students WHERE email = 'fpicado@estudiantec.cr')
);

-- ============================================
-- OPCIONES
-- ============================================
INSERT INTO election_options (election_id, label, option_type, display_order)
SELECT e.id, opt.label, 'candidate', opt.ord
FROM elections e
CROSS JOIN (
    VALUES 
        ('Opcion 1', 1),
        ('Opcion 2', 2),
        ('Opcion 3', 3)
) AS opt(label, ord);

-- ============================================
-- VOTANTES
-- ============================================
INSERT INTO election_voters (election_id, student_id)
SELECT e.id, s.id
FROM elections e
CROSS JOIN students s
ON CONFLICT DO NOTHING;

-- ============================================
-- MARCAR QUIENES VOTARON (~70%)
-- ============================================
-- ============================================
-- MARCAR QUIENES VOTARON (~70%) - MAS IRREGULAR
-- ============================================
UPDATE election_voters ev
SET 
    token_used = true,
    token_used_at = (
        e.start_time 
        + (
            -- distribución no uniforme (más irregular)
            (random() ^ 3) * (e.end_time - e.start_time)
        )
        -- ruido extra en minutos y segundos
        + (random() * interval '59 minutes')
        + (random() * interval '59 seconds')
    )
FROM elections e
WHERE ev.election_id = e.id
AND random() < 0.7;
-- ============================================
-- CREAR VOTOS
-- ============================================
INSERT INTO votes (election_id, option_id, student_id, created_at)
SELECT
    ev.election_id,
    o.id,
    ev.student_id,
    ev.token_used_at
FROM election_voters ev
JOIN LATERAL (
    SELECT id 
    FROM election_options 
    WHERE election_id = ev.election_id
    ORDER BY random()
    LIMIT 1
) o ON true
WHERE ev.token_used = true
ON CONFLICT DO NOTHING;
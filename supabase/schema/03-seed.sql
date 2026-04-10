-- ============================================================
-- 03-seed.sql
-- Datos de prueba para desarrollo local
--
-- Objetivo:
-- 1) Reiniciar datos transaccionales de votacion.
-- 2) Insertar estudiantes y administradores base.
-- 3) Crear dos elecciones de ejemplo:
--    - Una no anonima (voto vinculado a student_id).
--    - Una anonima (voto con token_hash, sin student_id).
--
-- Nota:
-- Este script esta orientado a pruebas y demo; no usar como referencia
-- de datos reales de produccion.
-- ============================================================

-- ============================================================
-- LIMPIEZA DE DATOS TRANSACCIONALES
-- ============================================================
-- Reinicia tablas de votacion y sus secuencias para obtener un estado limpio
-- en cada ejecucion del seed.

TRUNCATE votes, election_voters, election_options, elections RESTART IDENTITY CASCADE;

-- ============================================================
-- USUARIOS BASE
-- ============================================================
-- Se insertan usuarios iniciales para pruebas de autenticacion y permisos.
-- ON CONFLICT evita errores si el script se ejecuta varias veces.

INSERT INTO students (carnet, full_name, email, sede, career, degree_level)
VALUES 
('2024080534', 'Jose Fabian Zumbado Ruiz', 'j.zumbado.1@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato'),
('2022104933', 'Fabricio Picado Alvarado', 'fpicado@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato'),
-- Caso de prueba intencional: correo fuera del dominio institucional.
('9999999999', 'Fabricio Test Gmail', 'fabripicado@gmail.com', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato')
ON CONFLICT (email) DO NOTHING;

INSERT INTO admins (students_id, position_title, role, permissions)
SELECT id, 'Administrador', 'admin', '{"all": true}'::jsonb
FROM students 
WHERE email IN ('j.zumbado.1@estudiantec.cr', 'fpicado@estudiantec.cr')
ON CONFLICT DO NOTHING;

-- ============================================================
-- PADRON DE PRUEBA ADICIONAL
-- ============================================================
-- Registros extra para simular participacion y permitir resultados visibles.

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

-- ============================================================
-- ELECCION 1: NO ANONIMA
-- ============================================================
-- Caracteristicas:
-- - Voto asociado a student_id.
-- - Metodo de autenticacion MICROSOFT.
-- - Fuente de votantes filtrada por carrera.

INSERT INTO elections (
    title, description, status, is_anonymous,
    auth_method, voter_source, voter_filter,
    requires_keys, min_keys, start_time, end_time, created_by
)
SELECT
    'Elección Representantes Estudiantiles 2026',
    'Elección de representantes estudiantiles',
    'OPEN',
    false, 
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

-- Opciones de votacion
INSERT INTO election_options (election_id, label, option_type, display_order)
SELECT id, 'Candidato A', 'candidate', 1
FROM elections WHERE title = 'Elección Representantes Estudiantiles 2026';

INSERT INTO election_options (election_id, label, option_type, display_order)
SELECT id, 'Candidato B', 'candidate', 2
FROM elections WHERE title = 'Elección Representantes Estudiantiles 2026';

-- Padron de esta eleccion (solo Ingenieria en Computacion)
INSERT INTO election_voters (election_id, student_id)
SELECT e.id, s.id
FROM elections e
JOIN students s ON s.career = 'Ingenieria en Computacion'
WHERE e.title = 'Elección Representantes Estudiantiles 2026';

-- Simular participacion: ~85% de votantes marcan token como usado.
-- Se distribuye token_used_at en las ultimas 24 horas para pruebas de
-- reportes temporales.
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

-- Insertar votos (no anonima): se usa student_id en la tabla votes.
-- Regla de simulacion: carnet par vota A, carnet impar vota B.
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
    (s.carnet::bigint % 2 = 0 AND o.label = 'Candidato A') OR
    (s.carnet::bigint % 2 != 0 AND o.label = 'Candidato B')
);

-- ============================================================
-- ELECCION 2: ANONIMA
-- ============================================================
-- Caracteristicas:
-- - Voto anonimo (sin student_id).
-- - Metodo de autenticacion EMAIL_TOKEN.
-- - Fuente de votantes: padron completo.

INSERT INTO elections (
    title, description, status, is_anonymous,
    auth_method, voter_source, voter_filter,
    requires_keys, min_keys, start_time, end_time, created_by
)
SELECT
    'Referéndum Estudiantil 2026',
    'Consulta sobre cambios en reglamento estudiantil',
    'OPEN',
    true,
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

-- Opciones de votacion
INSERT INTO election_options (election_id, label, option_type, display_order)
SELECT id, 'Sí', 'option', 1
FROM elections WHERE title = 'Referéndum Estudiantil 2026';

INSERT INTO election_options (election_id, label, option_type, display_order)
SELECT id, 'No', 'option', 2
FROM elections WHERE title = 'Referéndum Estudiantil 2026';

-- Padron de esta eleccion (todos los estudiantes cargados)
INSERT INTO election_voters (election_id, student_id)
SELECT e.id, s.id
FROM elections e
JOIN students s ON true
WHERE e.title = 'Referéndum Estudiantil 2026';

-- Simular participacion: ~60% de votantes.
-- Se distribuye token_used_at en las ultimas 48 horas.
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

-- Insertar votos (anonima): se usa token_hash pseudoaleatorio.
-- No se registra student_id para preservar anonimato a nivel de dataset.
INSERT INTO votes (election_id, option_id, token_hash, created_at)
SELECT 
    ev.election_id,
    o.id,
    md5(random()::text || clock_timestamp()::text), 
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
-- ============================================================
-- ADMIN ADICIONAL DE PRUEBA
-- ============================================================
-- Usuario de soporte para pruebas de login y permisos administrativos.
INSERT INTO students (carnet, full_name, email, sede, career, degree_level)
VALUES ('2022437529', 'Aarón Ortiz Jiménez', 'aaortiz@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato')
VALUES ('2022437963', 'Mariela Solano Gómez', 'm.solano@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato')
ON CONFLICT (email) DO NOTHING;

INSERT INTO admins (students_id, position_title, role, permissions)
SELECT id, 'Administrador', 'admin', '{"all": true}'::jsonb
FROM students WHERE email = 'aaortiz@estudiantec.cr'
FROM students WHERE email = 'm.solano@estudiantec.cr'
ON CONFLICT DO NOTHING;

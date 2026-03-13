-- Seed: admin user j.zumbado.1@estudiantec.cr
INSERT INTO students (carnet, full_name, email, sede, career, degree_level)
VALUES ('2024080534', 'Jose Fabian Zumbado Ruiz', 'j.zumbado.1@estudiantec.cr', 'Cartago', 'Ingenieria en Computacion', 'Bachillerato')
ON CONFLICT (email) DO NOTHING;

INSERT INTO admins (students_id, position_title, role, permissions)
SELECT id, 'Administrador', 'admin', '{"all": true}'::jsonb
FROM students WHERE email = 'j.zumbado.1@estudiantec.cr'
ON CONFLICT DO NOTHING;

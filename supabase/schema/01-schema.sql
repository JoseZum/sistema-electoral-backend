-- ENUMS
CREATE TYPE election_status AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'SCRUTINIZED', 'ARCHIVED');
CREATE TYPE auth_method_type AS ENUM ('MICROSOFT', 'EMAIL_TOKEN', 'BOTH');
CREATE TYPE voter_source_type AS ENUM ('FULL_PADRON', 'FILTERED', 'MANUAL');

-- TABLAS VOTACIONES
CREATE TABLE election (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT,

    status          election_status NOT NULL DEFAULT 'DRAFT',
    is_anonymous    BOOLEAN NOT NULL DEFAULT true,
    auth_method     auth_method_type NOT NULL DEFAULT 'MICROSOFT',

    start_time      TIMESTAMPTZ,
    end_time        TIMESTAMPTZ,

    created_by      UUID REFERENCES tee_members(id),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    requires_keys   BOOLEAN NOT NULL DEFAULT false,
    min_keys        INT

    -- coherencia temporal
    CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time),

    -- coherencia de llaves (si no requiere llaves, min_keys debe ser NULL)
    CHECK (
      (requires_keys = false AND min_keys IS NULL)
      OR
      (requires_keys = true AND min_keys >= 1)
    )
);

CREATE TABLE election_option (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id     UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    label           TEXT NOT NULL, -- Texto visible de la opción
    display_order   INT NOT NULL DEFAULT 0,
    is_system       BOOLEAN NOT NULL DEFAULT false,
    metadata        JSONB -- Para datos no estructurados 
);

CREATE TABLE election_voter (
    election_id     UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    carnet          TEXT NOT NULL REFERENCES students(carnet),
    has_voted       BOOLEAN NOT NULL DEFAULT false,
    voted_at        TIMESTAMPTZ,
    auth_token_hash TEXT,                    -- Hash del token enviado por email (si aplica)
    PRIMARY KEY (election_id, carnet)
);

CREATE TABLE student (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    carnet          TEXT NOT NULL UNIQUE,
    full_name       TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    sede            TEXT NOT NULL,
    career          TEXT NOT NULL,
    degree_level    TEXT NULL,         -- Bachillerato, Licenciatura, etc.
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_student_carnet ON students(carnet);
CREATE INDEX idx_student_email ON students(email);
CREATE INDEX idx_student_career ON students(career);
CREATE INDEX idx_student_sede ON students(sede);
CREATE INDEX idx_student_active ON students(is_active);

CREATE TABLE vote (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id     UUID NOT NULL REFERENCES elections(id),
    option_id       UUID NOT NULL REFERENCES election_options(id),
    vote_hash       TEXT NOT NULL, -- Hash criptográfico irreversible
    voter_id        TEXT NULL, -- Para votaciones no anónimas (NULL si anónima)
    FOREIGN KEY (voter_id) REFERENCES student(id), 
    created_at      TIMESTAMPTZ DEFAULT now()
);
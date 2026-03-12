-- ============================================
-- ENUMS
-- ============================================
CREATE TYPE election_status AS ENUM ('DRAFT', 'OPEN', 'CLOSED', 'SCRUTINIZED', 'ARCHIVED');
CREATE TYPE auth_method_type AS ENUM ('MICROSOFT', 'EMAIL_TOKEN', 'BOTH');
CREATE TYPE voter_source_type AS ENUM ('FULL_PADRON', 'FILTERED', 'MANUAL');
CREATE TYPE election_type AS ENUM ('ELECTORAL_MASIVA', 'PLENARIO', 'INTERNA');
CREATE TYPE option_type AS ENUM ('CANDIDATE', 'IN_FAVOR', 'AGAINST', 'BLANK', 'NULL_VOTE', 'ABSTENTION', 'CUSTOM');

-- ============================================
-- PADRON ESTUDIANTIL
-- ============================================
CREATE TABLE students (
    carnet          TEXT PRIMARY KEY,
    full_name       TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    sede            TEXT NOT NULL,
    career          TEXT NOT NULL,
    degree_level    TEXT NOT NULL,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_students_email ON students(email);
CREATE INDEX idx_students_career ON students(career);
CREATE INDEX idx_students_sede ON students(sede);
CREATE INDEX idx_students_active ON students(is_active);

-- ============================================
-- USUARIOS ADMINISTRATIVOS (TEE)
-- ============================================
CREATE TABLE tee_members (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    carnet          TEXT NOT NULL REFERENCES students(carnet),
    position_title  TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'member',
    permissions     JSONB NOT NULL DEFAULT '{}',
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- VOTACIONES / ELECCIONES
-- ============================================
CREATE TABLE elections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           TEXT NOT NULL,
    description     TEXT,
    type            election_type NOT NULL,
    status          election_status NOT NULL DEFAULT 'DRAFT',
    is_anonymous    BOOLEAN NOT NULL DEFAULT true,
    auth_method     auth_method_type NOT NULL DEFAULT 'MICROSOFT',
    voter_source    voter_source_type NOT NULL,
    voter_filter    JSONB,
    requires_keys   BOOLEAN DEFAULT false,
    min_keys        INT DEFAULT 3,
    start_time      TIMESTAMPTZ,
    end_time        TIMESTAMPTZ,
    created_by      UUID REFERENCES tee_members(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- OPCIONES DE VOTACION
-- ============================================
CREATE TABLE election_options (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id     UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    label           TEXT NOT NULL,
    option_type     option_type NOT NULL,
    display_order   INT NOT NULL DEFAULT 0,
    metadata        JSONB
);

-- ============================================
-- VOTANTES ELEGIBLES POR ELECCION
-- ============================================
CREATE TABLE election_voters (
    election_id     UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    carnet          TEXT NOT NULL REFERENCES students(carnet),
    has_voted       BOOLEAN NOT NULL DEFAULT false,
    voted_at        TIMESTAMPTZ,
    auth_token_hash TEXT,
    PRIMARY KEY (election_id, carnet)
);

CREATE INDEX idx_election_voters_election ON election_voters(election_id);
CREATE INDEX idx_election_voters_carnet ON election_voters(carnet);

-- ============================================
-- VOTOS EMITIDOS (SEPARADOS DE IDENTIDAD)
-- ============================================
CREATE TABLE votes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id     UUID NOT NULL REFERENCES elections(id),
    option_id       UUID NOT NULL REFERENCES election_options(id),
    vote_hash       TEXT NOT NULL,
    voter_carnet    TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_votes_election ON votes(election_id);

-- ============================================
-- LLAVES DE ESCRUTINIO
-- ============================================
CREATE TABLE scrutiny_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id     UUID NOT NULL REFERENCES elections(id),
    member_id       UUID NOT NULL REFERENCES tee_members(id),
    key_shard       TEXT NOT NULL,
    has_submitted   BOOLEAN DEFAULT false,
    submitted_at    TIMESTAMPTZ
);

-- ============================================
-- LOGS DE AUDITORIA
-- ============================================
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        UUID,
    actor_carnet    TEXT,
    action          TEXT NOT NULL,
    resource_type   TEXT,
    resource_id     TEXT,
    details         JSONB,
    ip_address      TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- ============================================
-- HISTORIAL DE PADRONES CARGADOS
-- ============================================
CREATE TABLE padron_uploads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by     UUID REFERENCES tee_members(id),
    file_name       TEXT,
    total_records   INT,
    new_students    INT,
    removed_students INT,
    updated_students INT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

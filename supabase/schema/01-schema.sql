-- ============================================
-- ENUMS
-- ============================================
CREATE TYPE election_status AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'SCRUTINIZED', 'ARCHIVED');
CREATE TYPE auth_method_type AS ENUM ('MICROSOFT', 'EMAIL_TOKEN', 'BOTH');
CREATE TYPE voter_source_type AS ENUM ('FULL_PADRON', 'FILTERED', 'MANUAL');

-- ============================================
-- PADRON ESTUDIANTIL
-- ============================================
CREATE TABLE students (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    carnet          TEXT NOT NULL UNIQUE,
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
CREATE TABLE admins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    students_id     UUID NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
    position_title  TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'admin',
    permissions     JSONB NOT NULL DEFAULT '{}',
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
    status          election_status NOT NULL DEFAULT 'DRAFT',
    is_anonymous    BOOLEAN NOT NULL DEFAULT true,
    auth_method     auth_method_type NOT NULL DEFAULT 'MICROSOFT',
    voter_source    voter_source_type NOT NULL,
    voter_filter    JSONB,
    requires_keys   BOOLEAN DEFAULT false,
    min_keys        INT DEFAULT 3,
    start_time      TIMESTAMPTZ,
    end_time        TIMESTAMPTZ,
    scrutinized_at  TIMESTAMPTZ,
    created_by      UUID REFERENCES students(id),
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
    option_type     TEXT NOT NULL,
    display_order   INT NOT NULL DEFAULT 0,
    metadata        JSONB
);

-- ============================================
-- VOTANTES ELEGIBLES POR ELECCION
-- ============================================
CREATE TABLE election_voters (
    election_id     UUID NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    student_id      UUID NOT NULL REFERENCES students(id),
    token_used      BOOLEAN DEFAULT false,
    token_used_at   TIMESTAMPTZ,
    PRIMARY KEY (election_id, student_id)
);

CREATE INDEX idx_election_voters_election ON election_voters(election_id);
CREATE INDEX idx_election_voters_student ON election_voters(student_id);

-- ============================================
-- CODIGOS / TOKENS DE ACCESO PARA VOTO ANONIMO
-- ============================================
CREATE TABLE voting_tokens (
    election_id      UUID NOT NULL,
    student_id       UUID NOT NULL,
    code_hash        TEXT,
    token_hash       TEXT,
    token_encrypted  TEXT,
    used             BOOLEAN DEFAULT false,
    generated_at     TIMESTAMPTZ DEFAULT now(),
    used_at          TIMESTAMPTZ,
    PRIMARY KEY (election_id, student_id),
    CONSTRAINT fk_voting_tokens_voter
        FOREIGN KEY (election_id, student_id)
        REFERENCES election_voters(election_id, student_id)
        ON DELETE CASCADE
);

CREATE INDEX idx_voting_tokens_student ON voting_tokens(student_id);
CREATE INDEX idx_voting_tokens_code_hash ON voting_tokens(election_id, student_id, code_hash) WHERE code_hash IS NOT NULL;
CREATE UNIQUE INDEX uniq_voting_tokens_hash ON voting_tokens(token_hash) WHERE token_hash IS NOT NULL;

-- ============================================
-- VOTOS EMITIDOS (SEPARADOS DE IDENTIDAD)
-- ============================================
CREATE TABLE votes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id     UUID NOT NULL REFERENCES elections(id),
    option_id       UUID NOT NULL REFERENCES election_options(id),
    token_hash      TEXT,
    student_id      UUID REFERENCES students(id),
    created_at      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_vote_identity CHECK (
        (token_hash IS NOT NULL AND student_id IS NULL)
        OR (token_hash IS NULL AND student_id IS NOT NULL)
    )
);

CREATE INDEX idx_votes_election ON votes(election_id);
CREATE INDEX idx_votes_election_option ON votes(election_id, option_id);
CREATE UNIQUE INDEX uniq_votes_token ON votes(token_hash) WHERE token_hash IS NOT NULL;
CREATE UNIQUE INDEX uniq_votes_student ON votes(election_id, student_id) WHERE student_id IS NOT NULL;

-- ============================================
-- LLAVES DE ESCRUTINIO
-- ============================================
CREATE TABLE scrutiny_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    election_id     UUID NOT NULL REFERENCES elections(id),
    member_id       UUID NOT NULL REFERENCES students(id),
    key_shard       TEXT NOT NULL,
    has_submitted   BOOLEAN DEFAULT false,
    submitted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT uniq_scrutiny_member UNIQUE (election_id, member_id)
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
    uploaded_by     UUID REFERENCES students(id),
    file_name       TEXT,
    total_records   INT,
    new_students    INT,
    removed_students INT,
    updated_students INT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

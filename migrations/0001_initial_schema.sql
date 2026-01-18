-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 진단검사의학재단 인증심사 시스템 데이터베이스 스키마
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

-- 1. 분야 분류 테이블
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,           -- 분야코드 (예: 01, 02)
  name TEXT NOT NULL,                  -- 분야명
  description TEXT,                    -- 설명
  sort_order INTEGER DEFAULT 0,        -- 정렬순서
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_categories_code ON categories(code);
CREATE INDEX idx_categories_sort_order ON categories(sort_order);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 2. 담당자 관리 테이블
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                  -- 이름
  department TEXT,                     -- 소속
  specialties TEXT,                    -- 전문분야 (JSON 배열)
  email TEXT,                          -- 이메일
  phone TEXT,                          -- 전화번호
  role TEXT CHECK(role IN ('관리자', '심사위원', '검토자', '뷰어')),
  active BOOLEAN DEFAULT 1,            -- 활성 상태
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_managers_email ON managers(email);
CREATE INDEX idx_managers_role ON managers(role);
CREATE INDEX idx_managers_active ON managers(active);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 3. 심사문항 마스터 테이블
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS assessment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_number TEXT UNIQUE NOT NULL,    -- 문항번호 (예: 01.010.020)
  year TEXT NOT NULL,                  -- 년도 (예: 2025)
  type TEXT CHECK(type IN ('핵심C', '필수R', '기본B')),
  category_id INTEGER,                 -- 분야 (FK)
  title TEXT NOT NULL,                 -- 문항 제목
  content TEXT,                        -- 문항 내용
  scoring_method TEXT CHECK(scoring_method IN ('점검표', '등급제', '4단계', '2단계')),
  evaluation_options TEXT,             -- 평가옵션 (JSON 배열: ["예", "아니오", "부분감점", "해당없음"])
  required_documents TEXT,             -- 필수 증빙자료 (JSON 배열)
  status TEXT CHECK(status IN ('🟢 사용중', '🟡 검토중', '🔴 폐기됨')) DEFAULT '🟢 사용중',
  tags TEXT,                           -- 태그 (JSON 배열: ["신규", "수정", "중요"])
  priority TEXT CHECK(priority IN ('높음', '보통', '낮음')) DEFAULT '보통',
  assigned_to INTEGER,                 -- 담당자 (FK)
  
  -- 상세 정보
  criteria TEXT,                       -- 심사 기준
  method TEXT,                         -- 심사 방법
  notes TEXT,                          -- 내부 메모
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES managers(id) ON DELETE SET NULL
);

CREATE INDEX idx_assessment_items_number ON assessment_items(item_number);
CREATE INDEX idx_assessment_items_year ON assessment_items(year);
CREATE INDEX idx_assessment_items_type ON assessment_items(type);
CREATE INDEX idx_assessment_items_category ON assessment_items(category_id);
CREATE INDEX idx_assessment_items_status ON assessment_items(status);
CREATE INDEX idx_assessment_items_priority ON assessment_items(priority);
CREATE INDEX idx_assessment_items_assigned ON assessment_items(assigned_to);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 4. 개정 이력 테이블
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS revision_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,            -- 문항 (FK)
  year TEXT NOT NULL,                  -- 년도
  revision_type TEXT CHECK(revision_type IN ('신규', '수정', '삭제', '통합', '분리')),
  change_date DATE,                    -- 개정일
  effective_date DATE,                 -- 시행일
  change_description TEXT,             -- 변경내용
  reason TEXT,                         -- 변경사유
  changed_by INTEGER,                  -- 변경자 (FK)
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (item_id) REFERENCES assessment_items(id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES managers(id) ON DELETE SET NULL
);

CREATE INDEX idx_revision_history_item ON revision_history(item_id);
CREATE INDEX idx_revision_history_year ON revision_history(year);
CREATE INDEX idx_revision_history_type ON revision_history(revision_type);
CREATE INDEX idx_revision_history_change_date ON revision_history(change_date);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 5. 댓글/협업 테이블
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,            -- 문항 (FK)
  author_id INTEGER NOT NULL,          -- 작성자 (FK)
  content TEXT NOT NULL,               -- 댓글 내용
  parent_id INTEGER,                   -- 답글인 경우 부모 댓글 ID
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (item_id) REFERENCES assessment_items(id) ON DELETE CASCADE,
  FOREIGN KEY (author_id) REFERENCES managers(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

CREATE INDEX idx_comments_item ON comments(item_id);
CREATE INDEX idx_comments_author ON comments(author_id);
CREATE INDEX idx_comments_parent ON comments(parent_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 6. 첨부파일 테이블
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,            -- 문항 (FK)
  file_name TEXT NOT NULL,             -- 파일명
  file_type TEXT,                      -- 파일 타입
  file_size INTEGER,                   -- 파일 크기 (bytes)
  file_url TEXT NOT NULL,              -- 파일 URL (R2 Storage)
  uploaded_by INTEGER,                 -- 업로드자 (FK)
  
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (item_id) REFERENCES assessment_items(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES managers(id) ON DELETE SET NULL
);

CREATE INDEX idx_attachments_item ON attachments(item_id);

-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- 트리거: updated_at 자동 업데이트
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE TRIGGER update_categories_timestamp 
AFTER UPDATE ON categories
BEGIN
  UPDATE categories SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER update_managers_timestamp 
AFTER UPDATE ON managers
BEGIN
  UPDATE managers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER update_assessment_items_timestamp 
AFTER UPDATE ON assessment_items
BEGIN
  UPDATE assessment_items SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER update_comments_timestamp 
AFTER UPDATE ON comments
BEGIN
  UPDATE comments SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- hinayoi schema
-- usage: mysql -u ai -p hinayoi < sql/schema.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  login_id VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_login_id (login_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS characters (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug VARCHAR(32) NOT NULL,
  display_name VARCHAR(32) NOT NULL,
  voice_id VARCHAR(64) NOT NULL,
  image_file VARCHAR(64) NOT NULL,
  position TINYINT UNSIGNED NOT NULL,
  points INT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_characters_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS topics (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  text VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  speaker_kind ENUM('user','character') NOT NULL,
  speaker_name VARCHAR(32) NOT NULL,
  text TEXT NOT NULL,
  topic_id INT UNSIGNED NULL,
  nomikai_session_id VARCHAR(36) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_conversations_created_at (created_at),
  KEY idx_conversations_nomikai_session (nomikai_session_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 既存DBの移行:
--   ALTER TABLE conversations
--     ADD COLUMN nomikai_session_id VARCHAR(36) NULL AFTER topic_id,
--     ADD KEY idx_conversations_nomikai_session (nomikai_session_id, id);

-- TTS用置換リスト
CREATE TABLE IF NOT EXISTS tts_replacements (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  src VARCHAR(64) NOT NULL,
  dst VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tts_src (src)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 音声認識置換リスト（漢字→ひらがな名前）
CREATE TABLE IF NOT EXISTS asr_replacements (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  src VARCHAR(64) NOT NULL,
  dst VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_asr_src (src)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- アプリの現在状態（現在の話題ID等）
CREATE TABLE IF NOT EXISTS app_state (
  k VARCHAR(32) NOT NULL,
  v VARCHAR(255) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- seed: characters
INSERT IGNORE INTO characters (slug, display_name, voice_id, image_file, position, points) VALUES
  ('hiyori', 'ひより', 'OSwaPSNdfituxkWcjlkR', 'hiyori.png', 1, 0),
  ('misaki', 'みさき', 'ugYcuAusTuWCSOpJD0Xd', 'misaki.png', 2, 0),
  ('koharu', 'こはる', 'hMK7c1GPJmptCzI4bQIu', 'koharu.png', 3, 0),
  ('hina',   'ひな',   'lhTvHflPVOqgSWyuWQry', 'hina.png',   4, 0);

-- seed: topics (placeholder, 後で増やせる)
INSERT IGNORE INTO topics (id, text) VALUES
  (1, '最近ハマってる飲み物'),
  (2, 'おすすめの居酒屋メニュー'),
  (3, '休日の過ごし方'),
  (4, '最近見たドラマや映画'),
  (5, '行ってみたい旅行先');

-- seed: TTS置換例
INSERT IGNORE INTO tts_replacements (src, dst) VALUES
  ('頑張ろう', 'がんばろう');

-- seed: ASR置換例
INSERT IGNORE INTO asr_replacements (src, dst) VALUES
  ('陽菜', 'ひな'),
  ('小春', 'こはる'),
  ('都民', 'とみん');

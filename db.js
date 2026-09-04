import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'Cemal123',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0
};

let pool = null;

export async function initDatabase() {
  try {
    // 1. Veritabanı yoksa oluşturmak için başlangıç bağlantısı
    const rootConn = await mysql.createConnection(DB_CONFIG);
    await rootConn.query("CREATE DATABASE IF NOT EXISTS `tvplus_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;");
    await rootConn.end();

    // 2. Havuz oluştur
    pool = mysql.createPool({
      ...DB_CONFIG,
      database: 'tvplus_db'
    });

    console.log('[MySQL] ✅ tvplus_db veritabanına başarıyla bağlanıldı.');

    // 3. Tabloları oluştur
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        avatar VARCHAR(255) DEFAULT 'mascot',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS watch_progress (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT DEFAULT 1,
        profile_name VARCHAR(100) DEFAULT 'Cemal Küller',
        media_type ENUM('movie', 'episode') NOT NULL,
        series_id INT DEFAULT NULL,
        season_num INT DEFAULT 1,
        episode_id INT DEFAULT NULL,
        movie_id INT DEFAULT NULL,
        title VARCHAR(255) NOT NULL,
        poster TEXT,
        progress_seconds FLOAT DEFAULT 0,
        duration_seconds FLOAT DEFAULT 0,
        percentage FLOAT DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_episode (profile_name, media_type, series_id, episode_id),
        UNIQUE KEY uq_movie (profile_name, media_type, movie_id),
        INDEX idx_lookup (profile_name, updated_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tv_pairings (
        code VARCHAR(10) PRIMARY KEY,
        user_id INT DEFAULT NULL,
        username VARCHAR(100) DEFAULT NULL,
        status ENUM('pending', 'authorized', 'expired') DEFAULT 'pending',
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        id INT AUTO_INCREMENT PRIMARY KEY,
        profile_name VARCHAR(100) DEFAULT 'Cemal Küller',
        stream_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        icon TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_fav (profile_name, stream_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS media_catalog (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        platform_id VARCHAR(50) NOT NULL,
        media_type ENUM('movie', 'series') NOT NULL,
        media_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        release_year SMALLINT DEFAULT NULL,
        category_name VARCHAR(255) DEFAULT NULL,
        poster TEXT,
        rating DECIMAL(3,1) DEFAULT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_platform_media (platform_id, media_type, media_id),
        INDEX idx_platform_year (platform_id, release_year),
        INDEX idx_platform_category (platform_id, category_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`CREATE TABLE IF NOT EXISTS iptv_catalog_snapshot (
      action_key VARCHAR(64) PRIMARY KEY,
      payload LONGTEXT NOT NULL,
      fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

    // Varsayılan kullanıcı ekle
    const [existingUsers] = await pool.query('SELECT id FROM users WHERE username = ?', ['cemal']);
    if (existingUsers.length === 0) {
      const [res] = await pool.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', ['cemal', '123456', 'admin']);
      const userId = res.insertId;
      await pool.query('INSERT INTO profiles (user_id, name, avatar) VALUES (?, ?, ?)', [userId, 'Cemal Küller', 'mascot']);
      await pool.query('INSERT INTO profiles (user_id, name, avatar) VALUES (?, ?, ?)', [userId, 'Misafir', 'guest']);
      console.log('[MySQL] Varsayılan kullanıcı oluşturuldu: cemal / 123456 (Cemal Küller)');
    }

    return pool;
  } catch (err) {
    console.error('[MySQL] Bağlantı / Tablo Hatası:', err.message);
    throw err;
  }
}

export function getDb() {
  if (!pool) {
    throw new Error('Veritabanı henüz başlatılmadı.');
  }
  return pool;
}

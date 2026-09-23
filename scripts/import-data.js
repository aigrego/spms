#!/usr/bin/env node
'use strict';

/**
 * PostgreSQL Seed 导入脚本
 *
 * 配置: 读取项目根目录 .env.local > .env 中的 DATABASE_URL
 *       （也可用环境变量 DATABASE_URL 覆盖，优先级最高）
 *
 * 用法: node scripts/import-data.js <seed-name>
 * 示例: node scripts/import-data.js my-seed
 *       node scripts/import-data.js my-seed.seed
 */

const fs = require('fs');
const path = require('path');
const postgres = require('postgres');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');

/**
 * 解析 DATABASE_URL
 * 优先级: process.env > .env.local > .env（未配置则报错）
 */
function resolveDatabaseUrl() {
    const vars = {};
    // 先读 .env，再读 .env.local（后者覆盖前者）
    for (const name of ['.env', '.env.local']) {
        const filePath = path.join(ROOT_DIR, name);
        if (!fs.existsSync(filePath)) continue;
        console.log(`📄 加载配置: ${name}`);
        for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
            const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
            if (!match) continue;
            let value = match[2].trim();
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            vars[match[1]] = value;
        }
    }
    const url = process.env.DATABASE_URL || vars.DATABASE_URL;
    if (!url) {
        throw new Error('未找到 DATABASE_URL，请在 .env.local 或 .env 中配置（参考 .env.example）');
    }
    return url;
}

/**
 * 解析 seed 文件，获取需要执行的 SQL 文件列表
 * 支持 # 开头的注释行
 */
function parseSeedFile(seedFilePath) {
    if (!fs.existsSync(seedFilePath)) {
        throw new Error(`Seed 文件不存在: ${seedFilePath}`);
    }

    const sqlFiles = [];
    for (const line of fs.readFileSync(seedFilePath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        sqlFiles.push(trimmed);
    }

    return sqlFiles;
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.log('❌ 错误: 请提供 seed 文件名');
        console.log('');
        console.log('用法: node scripts/import-data.js <seed-name>');
        console.log('');
        console.log('示例:');
        console.log('  node scripts/import-data.js my-seed');
        console.log('  node scripts/import-data.js my-seed.seed');
        console.log('');
        console.log('可用的 seed 文件:');

        if (fs.existsSync(DATA_DIR)) {
            const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.seed'));
            if (files.length === 0) {
                console.log('  (暂无)');
            } else {
                files.forEach((f) => console.log(`  - ${f.replace('.seed', '')}`));
            }
        }
        process.exit(1);
    }

    let seedName = args[0];
    if (!seedName.endsWith('.seed')) {
        seedName += '.seed';
    }

    const seedFilePath = path.join(DATA_DIR, seedName);

    console.log('🌱 PostgreSQL Seed 导入工具');
    console.log('═══════════════════════════════════════════');
    console.log('');

    let databaseUrl;
    try {
        databaseUrl = resolveDatabaseUrl();
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exit(1);
    }

    let sqlFiles;
    try {
        sqlFiles = parseSeedFile(seedFilePath);
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exit(1);
    }

    console.log(`📋 Seed 文件: ${seedName}`);
    console.log(`   包含 ${sqlFiles.length} 个 SQL 文件:`);
    sqlFiles.forEach((file, index) => {
        console.log(`   ${index + 1}. ${file}`);
    });
    console.log('');

    const sql = postgres(databaseUrl, { max: 1 });

    try {
        const host = new URL(databaseUrl).hostname;
        console.log(`🔗 连接到 PostgreSQL: ${host}`);
        await sql`SELECT 1`;
        console.log('✅ 连接成功');
        console.log('');
    } catch (error) {
        console.error(`❌ 数据库连接失败: ${error.message}`);
        await sql.end();
        process.exit(1);
    }

    console.log('🚀 开始导入数据...');
    console.log('');

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < sqlFiles.length; i++) {
        const sqlFile = sqlFiles[i];
        const sqlFilePath = path.join(DATA_DIR, sqlFile);
        const progress = `[${i + 1}/${sqlFiles.length}]`;

        console.log(`${progress} 📄 ${sqlFile}`);

        try {
            if (!fs.existsSync(sqlFilePath)) {
                throw new Error(`SQL 文件不存在: ${sqlFilePath}`);
            }
            const sizeKB = (fs.statSync(sqlFilePath).size / 1024).toFixed(2);
            await sql.file(sqlFilePath);
            console.log(`   ✅ 导入成功 (${sizeKB} KB)`);
            successCount++;
        } catch (error) {
            console.log(`   ❌ 导入失败: ${error.message}`);
            failCount++;
        }
        console.log('');
    }

    await sql.end();

    console.log('═══════════════════════════════════════════');
    console.log('📊 导入完成');
    console.log(`   ✅ 成功: ${successCount}`);
    console.log(`   ❌ 失败: ${failCount}`);
    console.log('');

    if (failCount > 0) {
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(`❌ 脚本执行失败: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
});

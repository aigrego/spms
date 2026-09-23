#!/usr/bin/env node
'use strict';

/**
 * PostgreSQL 数据导出脚本 - 每个表单独导出
 *
 * 配置: 读取项目根目录 .env.local > .env 中的 DATABASE_URL
 *       （也可用环境变量 DATABASE_URL 覆盖，优先级最高）
 *
 * 用法: node scripts/export-data.js <seed-name> [options]
 *
 * 示例:
 *   # 导出全部表数据（每个表一个文件）
 *   node scripts/export-data.js my-seed
 *
 *   # 导出指定表
 *   node scripts/export-data.js my-seed --tables=members,projects
 *
 *   # 导出并排除某些表
 *   node scripts/export-data.js my-seed --exclude=sessions
 *
 *   # 同时导出表结构（需要本机安装 pg_dump；结构一般由 drizzle-kit 管理）
 *   node scripts/export-data.js my-seed --schema
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
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
 * 解析命令行参数
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        tables: '*',
        exclude: null,
        schema: false,
        schemaOnly: false,
        dataOnly: true,
        where: '',
        limit: 0
    };

    let seedName = null;

    for (const arg of args) {
        if (arg.startsWith('--')) {
            const [key, ...valueParts] = arg.split('=');
            const value = valueParts.join('=');
            const cleanKey = key.replace('--', '').replace(/-/g, '');

            if (cleanKey === 'tables') options.tables = value || '';
            else if (cleanKey === 'exclude') options.exclude = value !== undefined ? (value || '') : null;
            else if (cleanKey === 'schema') options.schema = true;
            else if (cleanKey === 'schemaonly') { options.schemaOnly = true; options.dataOnly = false; }
            else if (cleanKey === 'dataonly') { options.dataOnly = true; options.schemaOnly = false; }
            else if (cleanKey === 'where') options.where = value || '';
            else if (cleanKey === 'limit') options.limit = parseInt(value, 10) || 0;
        } else if (!seedName) {
            seedName = arg;
        }
    }

    return { seedName, options };
}

/**
 * 检查 pg_dump 是否可用
 */
function checkPgDump() {
    return new Promise((resolve) => {
        const proc = spawn('pg_dump', ['--version'], { stdio: 'ignore' });
        proc.on('error', () => resolve(false));
        proc.on('exit', (code) => resolve(code === 0));
    });
}

/**
 * 使用 pg_dump 导出单个表的结构
 */
function exportSchemaWithPgDump(databaseUrl, tableName) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        const proc = spawn('pg_dump', [
            databaseUrl,
            '--schema-only',
            '--no-owner',
            '--no-privileges',
            '--clean',
            '--if-exists',
            `--table=public.${tableName}`
        ]);

        proc.stdout.on('data', (chunk) => chunks.push(chunk));
        proc.stderr.on('data', (err) => {
            const msg = err.toString().trim();
            if (msg) console.log(`   ⚠️  ${msg}`);
        });

        proc.on('exit', (code) => {
            if (code !== 0) reject(new Error(`pg_dump 退出码: ${code}`));
            else resolve(Buffer.concat(chunks).toString('utf8'));
        });
        proc.on('error', reject);
    });
}

/**
 * SQL 字符串字面量转义（standard_conforming_strings=on）
 */
function quote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Postgres 数组字面量
 */
function arrayLiteral(arr) {
    const items = arr.map((item) => {
        if (item === null || item === undefined) return 'NULL';
        if (Array.isArray(item)) return arrayLiteral(item);
        if (item instanceof Date) return `"${item.toISOString()}"`;
        if (typeof item === 'number' || typeof item === 'boolean') return String(item);
        if (typeof item === 'object') return `"${JSON.stringify(item).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        return `"${String(item).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    });
    return `{${items.join(',')}}`;
}

/**
 * 按列类型把 JS 值序列化为 SQL 字面量
 * udt 为 information_schema.columns.udt_name（数组类型以 _ 开头）
 */
function literal(value, udt) {
    if (value === null || value === undefined) return 'NULL';

    switch (udt) {
        case 'bool':
            return value ? 'TRUE' : 'FALSE';
        case 'json':
        case 'jsonb':
            return quote(typeof value === 'string' ? value : JSON.stringify(value));
        case 'bytea': {
            const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
            return quote(`\\x${buf.toString('hex')}`);
        }
        case 'int2':
        case 'int4':
        case 'int8':
        case 'oid':
        case 'float4':
        case 'float8':
        case 'numeric': {
            const text = String(value);
            // int8/numeric 可能被解析成字符串；非数字形式（NaN/Infinity）加引号
            return /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text) ? text : quote(text);
        }
    }

    if (udt.startsWith('_')) return quote(arrayLiteral(value));
    if (value instanceof Date) return quote(value.toISOString());
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : quote(String(value));
    if (typeof value === 'object') return quote(JSON.stringify(value));
    return quote(String(value));
}

/**
 * 使用 Node.js 导出单个表的数据
 */
async function exportTableData(sql, tableName, options) {
    let output = '';

    output += `-- Exported by scripts/export-data.js\n`;
    output += `-- Table: ${tableName}\n`;
    output += `-- Date: ${new Date().toISOString()}\n`;
    output += `--\n\n`;

    const columns = await sql`
        SELECT column_name, udt_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tableName}
        ORDER BY ordinal_position
    `;

    if (columns.length === 0) {
        throw new Error(`表不存在: ${tableName}`);
    }

    const columnNames = columns.map((c) => c.column_name);
    let query = `SELECT ${columnNames.map((c) => `"${c}"`).join(', ')} FROM "${tableName}"`;
    if (options.where) query += ` WHERE ${options.where}`;
    if (options.limit > 0) query += ` LIMIT ${options.limit}`;

    const rows = await sql.unsafe(query);

    if (rows.length === 0) {
        return { content: null, rowCount: 0 };
    }

    output += `-- Data for ${tableName} (${rows.length} rows)\n\n`;

    const columnList = columnNames.map((c) => `"${c}"`).join(', ');
    const BATCH_SIZE = 100;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const values = batch.map((row) => {
            return '(' + columns.map((c) => literal(row[c.column_name], c.udt_name)).join(', ') + ')';
        }).join(',\n  ');

        output += `INSERT INTO "${tableName}" (${columnList}) VALUES\n  ${values}\nON CONFLICT DO NOTHING;\n\n`;
    }

    return { content: output, rowCount: rows.length };
}

/**
 * 获取 public schema 下的所有表
 */
async function getAllTables(sql) {
    const rows = await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
    `;
    return rows.map((r) => r.table_name);
}

/**
 * 按外键依赖对表做拓扑排序（被引用的表排在前面），避免导入时违反外键约束
 */
async function sortTablesByForeignKeys(sql, tables) {
    const deps = await sql`
        SELECT DISTINCT
            conrelid::regclass::text AS child,
            confrelid::regclass::text AS parent
        FROM pg_constraint
        WHERE contype = 'f' AND connamespace = 'public'::regnamespace
    `;

    const tableSet = new Set(tables);
    const childrenOf = new Map(); // parent -> children
    const parentCount = new Map(); // child -> 未满足的父表数

    for (const table of tables) {
        childrenOf.set(table, []);
        parentCount.set(table, 0);
    }
    for (const { child, parent } of deps) {
        if (!tableSet.has(child) || !tableSet.has(parent) || child === parent) continue;
        childrenOf.get(parent).push(child);
        parentCount.set(child, parentCount.get(child) + 1);
    }

    const queue = tables.filter((t) => parentCount.get(t) === 0).sort();
    const sorted = [];
    while (queue.length > 0) {
        const table = queue.shift();
        sorted.push(table);
        for (const child of childrenOf.get(table).sort()) {
            parentCount.set(child, parentCount.get(child) - 1);
            if (parentCount.get(child) === 0) queue.push(child);
        }
    }

    // 存在循环依赖时，剩余表按名称追加（导入需自行处理约束）
    const remaining = tables.filter((t) => !sorted.includes(t)).sort();
    if (remaining.length > 0) {
        console.log(`   ⚠️  检测到循环外键依赖，以下表按名称排序追加: ${remaining.join(', ')}`);
    }
    return [...sorted, ...remaining];
}

/**
 * 更新或创建 .seed 清单文件
 * 如果文件已存在，保留未导出的表条目，只更新/添加新导出的表
 */
function updateSeedFile(seedName, sqlFiles, exportedTableNames) {
    const seedFilePath = path.join(DATA_DIR, `${seedName}.seed`);

    // 保持 sqlFiles 的外键拓扑顺序（父表在前），seed 清单的顺序即导入执行顺序
    let allFiles = [...sqlFiles];
    let existingCount = 0;

    if (fs.existsSync(seedFilePath)) {
        const lines = fs.readFileSync(seedFilePath, 'utf8')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#'));

        const preserved = [];
        for (const line of lines) {
            const match = line.match(/([^/]+)\.sql$/);
            if (match && !exportedTableNames.includes(match[1])) {
                preserved.push(line);
                existingCount++;
            }
        }

        allFiles = [...new Set([...allFiles, ...preserved])];
    }

    const content = `# Seed file for ${seedName}
# Contains ${allFiles.length} table(s)

${allFiles.join('\n')}
`;

    fs.writeFileSync(seedFilePath, content);
    const msg = existingCount > 0
        ? `${seedName}.seed (${sqlFiles.length} 新增, ${existingCount} 保留, 共 ${allFiles.length} 个)`
        : `${seedName}.seed (${allFiles.length} files)`;
    console.log(`\n   📝 更新 seed 清单: ${msg}`);
}

function printUsage() {
    console.log('❌ 错误: 请提供 seed 名称');
    console.log('');
    console.log('用法: node scripts/export-data.js <seed-name> [options]');
    console.log('');
    console.log('选项:');
    console.log('  --tables=<list>       要导出的表，逗号分隔（默认导出全部）');
    console.log('  --exclude=<list>      排除的表，逗号分隔');
    console.log('  --schema              同时导出表结构（需要 pg_dump）');
    console.log('  --schema-only         只导出表结构（需要 pg_dump）');
    console.log('  --data-only           只导出数据（默认行为）');
    console.log('  --where=<condition>   导出条件');
    console.log('  --limit=<n>           限制每表导出行数');
    console.log('');
    console.log('示例:');
    console.log('  node scripts/export-data.js my-seed');
    console.log('  node scripts/export-data.js my-seed --tables=members,projects');
    console.log('  node scripts/export-data.js full-backup --exclude=sessions');
}

/**
 * 主函数
 */
async function main() {
    const { seedName, options } = parseArgs();

    if (!seedName) {
        printUsage();
        process.exit(1);
    }

    console.log('📤 PostgreSQL 数据导出工具');
    console.log('═══════════════════════════════════════════');
    console.log('');

    let databaseUrl;
    try {
        databaseUrl = resolveDatabaseUrl();
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exit(1);
    }

    // 结构导出依赖 pg_dump
    let hasPgDump = false;
    if (options.schema || options.schemaOnly) {
        hasPgDump = await checkPgDump();
        if (!hasPgDump) {
            console.error('❌ --schema / --schema-only 需要本机安装 pg_dump（未找到）');
            console.error('   提示: 本项目表结构由 drizzle-kit 管理（pnpm db:generate / db:migrate），通常无需导出结构');
            process.exit(1);
        }
    }

    const outputDir = path.join(DATA_DIR, seedName);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
        console.log(`📁 创建输出目录: data/${seedName}/`);
        console.log('');
    }

    const sql = postgres(databaseUrl, { max: 1 });

    let tables = [];
    try {
        const host = new URL(databaseUrl).hostname;
        console.log(`🔗 连接到 PostgreSQL: ${host}`);
        await sql`SELECT 1`;
        console.log('✅ 连接成功');
        console.log('');

        if (!options.tables || options.tables === '*') {
            tables = await getAllTables(sql);
            console.log(`📋 发现 ${tables.length} 个表`);
        } else {
            tables = options.tables.split(',').map((s) => s.trim()).filter(Boolean);
            console.log(`📋 指定表: ${tables.join(', ')}`);
        }

        if (options.exclude !== null) {
            const excludeList = options.exclude.split(',').map((s) => s.trim()).filter(Boolean);
            const skipped = tables.filter((t) => excludeList.includes(t));
            tables = tables.filter((t) => !excludeList.includes(t));
            if (skipped.length > 0) {
                console.log(`📋 已排除: ${skipped.join(', ')}`);
            }
        }

        tables = await sortTablesByForeignKeys(sql, tables);
        console.log(`📋 实际导出: ${tables.length} 个表（已按外键依赖排序）`);
        console.log('');
    } catch (error) {
        console.error(`❌ 数据库连接失败: ${error.message}`);
        await sql.end();
        process.exit(1);
    }

    const exportMode = options.schemaOnly ? '只导出结构' : (options.schema ? '结构+数据' : '只导出数据');
    console.log(`🚀 开始导出 (${exportMode})`);
    console.log(`   输出目录: data/${seedName}/`);
    console.log('');

    const exportedFiles = [];
    const failedTables = [];
    let totalSize = 0;

    for (let i = 0; i < tables.length; i++) {
        const tableName = tables[i];
        const progress = `[${i + 1}/${tables.length}]`;

        const safeTableName = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
        const sqlFileName = `${safeTableName}.sql`;
        const sqlFilePath = path.join(outputDir, sqlFileName);
        const seedFileEntry = path.join(seedName, sqlFileName);

        try {
            let sqlContent = '';
            let rowCount = 0;

            if (options.schema || options.schemaOnly) {
                sqlContent += await exportSchemaWithPgDump(databaseUrl, tableName);
                sqlContent += '\n';
            }

            if (!options.schemaOnly) {
                const result = await exportTableData(sql, tableName, options);
                rowCount = result.rowCount;

                // 纯数据模式下空表跳过
                if (!options.schema && rowCount === 0) {
                    console.log(`   ${progress} ⏭️  ${tableName.padEnd(30)} (empty, skipped)`);
                    continue;
                }
                if (result.content) {
                    sqlContent += result.content;
                }
            }

            fs.writeFileSync(sqlFilePath, sqlContent);
            const fileSize = fs.statSync(sqlFilePath).size;
            totalSize += fileSize;
            const fileSizeKB = (fileSize / 1024).toFixed(2);

            exportedFiles.push(seedFileEntry);

            const rowInfo = options.schemaOnly ? '(schema only)' : `(${rowCount} rows)`;
            console.log(`   ${progress} ✅ ${tableName.padEnd(30)} ${fileSizeKB.padStart(8)} KB ${rowInfo}`);
        } catch (error) {
            failedTables.push({ table: tableName, error: error.message });
            console.log(`   ${progress} ❌ ${tableName.padEnd(30)} ${error.message}`);
        }
    }

    updateSeedFile(seedName, exportedFiles, tables);

    await sql.end();

    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log('📊 导出完成');
    console.log(`   成功: ${exportedFiles.length}/${tables.length} 个表`);
    console.log(`   失败: ${failedTables.length} 个表`);
    console.log(`   总大小: ${(totalSize / 1024).toFixed(2)} KB`);
    console.log(`   输出目录: data/${seedName}/`);
    console.log('');

    if (failedTables.length > 0) {
        console.log('❌ 失败的表:');
        failedTables.forEach(({ table, error }) => {
            console.log(`   - ${table}: ${error}`);
        });
        console.log('');
    }

    console.log(`💡 导入命令: node scripts/import-data.js ${seedName}`);
    console.log('');

    if (failedTables.length > 0) {
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(`❌ 脚本执行失败: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
});

#!/usr/bin/env node
/**
 * fetch_topics.js — 从小程序后端下载题库，并解密成 topics_raw.json
 *
 * 这个接口的内容是 AES-128-CBC 加密的，但密钥就藏在响应里：
 *   key = CreationTime + "000000"
 *   iv  = "111111" + CreationTime
 * 所以只要拿到 token 就能完整下载。
 *
 * 鉴权只要两样东西：
 *   appid  —— 写死在小程序代码里，公开的
 *   openid —— 你本人的账号标识，等于身份凭证，**绝对不能提交到 git 或发给别人**
 *
 * ---------------------------------------------------------------------------
 * 用法（openid 不要写进本文件，用环境变量传）：
 *
 *   cmd:        set TIKU_OPENID=你的openid && node fetch_topics.js
 *   PowerShell: $env:TIKU_OPENID="你的openid"; node fetch_topics.js
 *   bash:       TIKU_OPENID=你的openid node fetch_topics.js
 *
 * 想换题库，改下面的 QBID 即可（题库列表见 README.md 的说明或调 /api/QuestionBank）。
 * ---------------------------------------------------------------------------
 */

const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------- 配置 ----------
const APPID = 'wxc007d9e9f0e8f1c4';
const BASE = 'https://acper.club/TikuNew';

// 阿里云 / ACP / ACP大模型
const QBID = '6189520b-83e4-4bb3-aec6-72d89a86b568';

const OPENID = process.env.TIKU_OPENID || '';
const HERE = __dirname;

// ---------- HTTP ----------
function request(pathname, { method = 'GET', token = '', params = null } = {}) {
  let url = BASE + pathname;
  if (params) url += '?' + new URLSearchParams(params).toString();
  const u = new URL(url);

  const headers = {
    'User-Agent': 'Mozilla/5.0',
    Accept: 'application/json',
  };
  if (token) headers.Authorization = token;

  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers, timeout: 120000 },
      res => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end();
  });
}

async function call(pathname, opts = {}) {
  const r = await request(pathname, opts);
  let json;
  try {
    json = JSON.parse(r.body);
  } catch (e) {
    throw new Error(`${pathname} 返回的不是 JSON（HTTP ${r.status}）：${r.body.slice(0, 200)}`);
  }
  return json;
}

// ---------- 解密 ----------
// 服务端返回 base64；key/iv 都是 16 字节，所以是 AES-128-CBC + PKCS7
function aesDecrypt(b64, creationTime) {
  const ct = String(creationTime);
  const decipher = crypto.createDecipheriv(
    'aes-128-cbc',
    Buffer.from(ct + '000000', 'utf8'),   // 16 字节
    Buffer.from('111111' + ct, 'utf8'),   // 16 字节
  );
  return Buffer.concat([
    decipher.update(Buffer.from(b64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

// ---------- 主流程 ----------
(async () => {
  if (!OPENID) {
    console.error('缺少 openid。请用环境变量传入：');
    console.error('  PowerShell: $env:TIKU_OPENID="你的openid"; node fetch_topics.js');
    console.error('  cmd:        set TIKU_OPENID=你的openid && node fetch_topics.js');
    console.error('  bash:       TIKU_OPENID=你的openid node fetch_topics.js');
    process.exit(1);
  }

  // 1. 换 token
  const tok = await call('/api/token', { params: { appid: APPID, openid: OPENID } });
  if (!tok.IsSuccess || !tok.Data) {
    throw new Error('取 token 失败：' + (tok.ErrorMessage || JSON.stringify(tok).slice(0, 200)));
  }
  const token = tok.Data;
  console.log('token 获取成功');

  // 2. 确认这个账号确实激活了该题库
  //    没激活时接口只返回 10 道试看题 —— 不检查就会静默导出一个残缺题库
  const act = await call('/api/IsActivationQBank', { token, params: { Qbid: QBID } });
  if (act.Data !== true) {
    throw new Error(
      '该账号未激活此题库（/api/IsActivationQBank 返回 ' + JSON.stringify(act.Data) + '）。\n' +
      '继续下载只会得到少量试看题，已中止。',
    );
  }
  console.log('题库激活状态：已激活');

  // 3. 下载题目
  const r = await call('/api/Topics', { token, params: { Qbid: QBID } });
  if (!r.IsSuccess || !r.Data) {
    throw new Error('下载题目失败：' + (r.ErrorMessage || JSON.stringify(r).slice(0, 200)));
  }
  console.log(`收到密文 ${r.Data.length} 字符，CreationTime=${r.CreationTime}`);

  // 4. 解密
  const plain = aesDecrypt(r.Data, r.CreationTime);
  const questions = JSON.parse(plain);
  if (!Array.isArray(questions)) {
    throw new Error('解密结果不是数组，密钥推导可能不对');
  }

  // 5. 完整性护栏
  if (questions.length <= 10) {
    throw new Error(`只返回了 ${questions.length} 道题，可能是未激活或接口限流，已中止`);
  }
  const noAnswer = questions.filter(q => !(q.Options || []).some(o => o.IsAnswer)).length;
  if (noAnswer > 0) {
    console.warn(`  注意：${noAnswer} 道题没有正确答案标记`);
  }

  // 6. 落盘（保持与旧版 topics_raw.json 相同的结构，build.js 才能直接用）
  const out = { qbid: QBID, creationTime: r.CreationTime, count: questions.length, questions };
  const outPath = path.join(HERE, 'topics_raw.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf8');

  // 7. 顺带更新 meta.json 里的错题/收藏记录（题库更新后这些 ID 可能失效）
  const metaPath = path.join(HERE, 'meta.json');
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const known = new Set(questions.map(q => q.Gid));
    for (const [key, type] of [['errRecords', 'err'], ['starRecords', 'star']]) {
      const rec = await call('/api/TopicRecord', { token, params: { Qbid: QBID, Type: type } });
      if (rec.IsSuccess && Array.isArray(rec.Data)) {
        const valid = rec.Data.filter(g => known.has(g));
        meta[key] = rec;
        console.log(`  ${type}: 服务器 ${rec.Data.length} 条，本题库内有效 ${valid.length} 条`);
      }
    }
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 1), 'utf8');
    console.log('meta.json 已更新');
  }

  console.log('');
  console.log('完成：');
  console.log(`  ${outPath}  （${questions.length} 题）`);
  console.log('下一步：node build.js');
})().catch(e => {
  console.error('失败：' + e.message);
  process.exit(1);
});

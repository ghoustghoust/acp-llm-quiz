#!/usr/bin/env node
/**
 * build.js — 把题库数据填进页面模板，生成单文件离线题库
 *
 * 输入：
 *   topics_raw.json  /api/Topics 下载并解密后的原始数据（含 Options[].IsAnswer、Analysis）
 *   meta.json        题库配置 + 该账号的错题/收藏记录 ID
 *   template.html    页面模板，内含占位符 __DATA__（在 <script id="bankdata"> 里）
 *
 * 输出：
 *   ../阿里云ACP大模型-离线题库.html
 *
 * 用法：
 *   cd D:\program\题库\work
 *   node build.js
 */

const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const OUT_NAME = '阿里云ACP大模型-离线题库.html';

// ---------- 1. 读输入 ----------
const raw = JSON.parse(fs.readFileSync(path.join(HERE, 'topics_raw.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(HERE, 'meta.json'), 'utf8'));
const tpl = fs.readFileSync(path.join(HERE, 'template.html'), 'utf8');

if (!tpl.includes('__DATA__')) {
  throw new Error('template.html 里找不到 __DATA__ 占位符');
}

// ---------- 2. 题目字段瘦身 ----------
// 原始数据字段很全（$id/Appid/QuestionEn/Medias/Link/Status…），页面只用得上这 4 个。
// 瘦身既减小体积，也避免把服务端内部字段写进交付文件。
const TYPE_MAP = { 单选题: '单选题', 多选题: '多选题', 判断题: '判断题', 填空题: '填空题' };

const questions = raw.questions.map(q => {
  const options = (q.Options || [])
    .map(o => ({
      t: String(o.TitleZh == null ? '' : o.TitleZh).trim(),
      ok: !!o.IsAnswer,
    }))
    .filter(o => o.t !== '');          // 丢弃空选项

  return {
    gid: q.Gid,
    type: TYPE_MAP[q.Type] || q.Type || '单选题',
    q: String(q.Question || '').trim(),
    options,
    analysis: String(q.Analysis || '').trim(),
  };
});

// ---------- 3. 数据自检（宁可构建失败，也不要产出一个坏题库）----------
const problems = [];
questions.forEach((q, i) => {
  if (!q.q) problems.push(`#${i + 1} 题干为空`);
  if (q.options.length < 2) problems.push(`#${i + 1} 选项不足 2 个`);
  if (!q.options.some(o => o.ok)) problems.push(`#${i + 1} 没有任何正确答案`);
  if (!q.analysis) problems.push(`#${i + 1} 缺少解析`);
  if (q.type === '单选题' && q.options.filter(o => o.ok).length !== 1) {
    problems.push(`#${i + 1} 单选题有多个正确答案`);
  }
  if (q.type === '多选题' && q.options.filter(o => o.ok).length < 2) {
    problems.push(`#${i + 1} 多选题正确答案少于 2 个`);
  }
});
if (problems.length) {
  console.error('构建中止，数据校验未通过：');
  problems.slice(0, 20).forEach(p => console.error('  - ' + p));
  if (problems.length > 20) console.error(`  ...还有 ${problems.length - 20} 处`);
  process.exit(1);
}

// ---------- 4. 组装 ----------
const known = new Set(questions.map(q => q.gid));
const errIds = (meta.errRecords && meta.errRecords.Data) || [];
const starIds = (meta.starRecords && meta.starRecords.Data) || [];

const bank = {
  key: 'aliyun-acp-llm',          // 决定浏览器 localStorage 的键名，改了等于重置进度
  title: '阿里云 ACP 大模型',
  subtitle: '全真题库 · 离线版',
  source: {
    appid: 'wxc007d9e9f0e8f1c4',
    qbid: raw.qbid,
    exportedAt: new Date().toISOString(),
    note: (meta.qbconfig && meta.qbconfig.Data && meta.qbconfig.Data.Tongzhi) || '',
  },
  // 只保留确实存在于本题库里的记录 ID，避免错题本指向不存在的题
  initialWrong: errIds.filter(g => known.has(g)),
  initialStar: starIds.filter(g => known.has(g)),
  questions,
};

// 内嵌进 <script> 时必须转义 < 和 >，否则题库里一旦出现 </script> 就会提前截断文档
const json = JSON.stringify(bank)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e');

// 用函数形式替换：避免替换串里的 $& / $' 被当成正则特殊序列
const out = tpl.replace('__DATA__', () => json);

// ---------- 5. 写文件 ----------
const outPath = path.resolve(HERE, '..', OUT_NAME);
fs.writeFileSync(outPath, out, 'utf8');

const stat = fs.statSync(outPath);
const nSingle = questions.filter(q => q.type === '单选题').length;
const nMulti = questions.filter(q => q.type === '多选题').length;

console.log('已生成:', outPath);
console.log(`  题量 ${questions.length}（单选 ${nSingle} / 多选 ${nMulti}）`);
console.log(`  预置错题 ${bank.initialWrong.length}，预置收藏 ${bank.initialStar.length}`);
console.log(`  文件大小 ${(stat.size / 1024).toFixed(1)} KB`);

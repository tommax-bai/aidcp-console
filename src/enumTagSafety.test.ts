/**
 * 枚举徽标安全闸（本仓无 ESLint，此测试即闸）。
 *
 * 崩溃类：控制台的枚举类型是手动镜像 cloud 的，会漂移。若组件直接写
 * `SOME_MAP[wireValue].color`（对象值映射按 wire 值取值后再读属性），遇到镜像里还没有的
 * 新枚举值就会 `undefined.color` 抛错、整页 white-screen（真实事故：`llmKind:'vision'`
 * 让 /roles 全崩）。唯一安全入口是 tagOf()（src/types/aidcp-enums.ts）：未知值回落灰底原值标签。
 *
 * 本测试扫描全部组件/页面源码，禁止 `大写映射[...] .color/.text/.label` 裸取。
 * 命中即失败并指出位置，要求改走 tagOf()。标量映射（`MAP[key]` 直接当 prop 值、不再 .prop）
 * 落空只是默认样式、不崩，故不在禁列。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url)); // 本文件位于 src/

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...collectSourceFiles(p));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (/\.test\.(ts|tsx)$/.test(name)) continue; // 测试/示例代码里可出现示范写法，不扫
    out.push(p);
  }
  return out;
}

/** 抹掉注释但保留换行（维持行号）：块注释、行注释、JSX 大括号内块注释。 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

// 大写常量映射（如 KIND_LABEL / SOURCE_TAG）按变量索引后直接读 .color/.text/.label 的裸取。
const OFFENSE = /[A-Z][A-Z0-9_]{2,}\[[^\]\n]+\]\.(?:color|text|label)\b/;

describe('enum tag safety', () => {
  it('对象值徽标映射一律经 tagOf() 取值，禁止 MAP[key].color/.text/.label 裸取', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC)) {
      const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (OFFENSE.test(line)) {
          offenders.push(`${file.replace(`${SRC}/`, 'src/')}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `以下裸取会在后端枚举漂移时白屏，请改走 tagOf()（src/types/aidcp-enums.ts）：\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

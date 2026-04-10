#!/usr/bin/env node

/**
 * knowledge.md 자동 생성 스크립트
 *
 * fastfive-web admin 코드에서 메뉴 구조, 라우트, 상태값 용어를 추출하여
 * extension/knowledge.md를 자동 생성합니다.
 *
 * 사용법:
 *   node scripts/generate-knowledge.js
 *   node scripts/generate-knowledge.js --admin-path /path/to/fastfive-web/apps/admin
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// --- Config ---
// ============================================================

const DEFAULT_ADMIN_PATH = path.resolve(__dirname, '../../fastfive-web/apps/admin');

function getAdminPath() {
  const argIndex = process.argv.indexOf('--admin-path');
  if (argIndex !== -1 && process.argv[argIndex + 1]) {
    return path.resolve(process.argv[argIndex + 1]);
  }
  return DEFAULT_ADMIN_PATH;
}

const ADMIN_PATH = getAdminPath();
const OUTPUT_PATH = path.resolve(__dirname, '../extension/knowledge.md');

// ============================================================
// --- Menu Extractor ---
// ============================================================

function extractMenus() {
  const filePath = path.join(ADMIN_PATH, 'src/utils/side-menu.ts');
  if (!fs.existsSync(filePath)) {
    console.warn('[WARN] side-menu.ts not found:', filePath);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  // Line-by-line parsing with pending deprecated flag
  const categories = [];
  const lines = content.split('\n');

  let currentCategory = null;
  let currentMenus = [];
  let inMenusBlock = false;
  let depth = 0;
  let pendingDeprecated = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // isDeprecated always comes BEFORE the item it belongs to
    if (trimmed === 'isDeprecated: true,') {
      pendingDeprecated = true;
      continue;
    }

    // Detect category start: "name: 'xxx',"
    const catMatch = trimmed.match(/^name:\s*'([^']+)'/);
    if (catMatch && !inMenusBlock) {
      if (currentCategory) {
        categories.push({ ...currentCategory, menus: currentMenus });
      }
      currentCategory = {
        name: catMatch[1],
        text: '',
        isDeprecated: pendingDeprecated,
      };
      currentMenus = [];
      pendingDeprecated = false;
    }

    // Detect category text
    const textMatch = trimmed.match(/^text:\s*'([^']+)'/);
    if (textMatch && !inMenusBlock && currentCategory && !currentCategory.text) {
      currentCategory.text = textMatch[1];
    }

    // Detect menus block start
    if (trimmed === 'menus: [') {
      inMenusBlock = true;
      depth = 0;
      continue;
    }

    if (inMenusBlock) {
      // Track depth
      for (const char of trimmed) {
        if (char === '{') { depth++; }
        if (char === '}') { depth--; }
      }

      // Extract menu item properties
      const idMatch = trimmed.match(/^id:\s*'([^']+)'/);
      const menuTextMatch = trimmed.match(/^text:\s*'([^']+)'/);
      const routeMatch = trimmed.match(/^routeName:\s*'([^']+)'/);

      if (idMatch) {
        currentMenus.push({
          id: idMatch[1],
          text: '',
          routeName: '',
          isDeprecated: pendingDeprecated,
        });
        pendingDeprecated = false;
      }
      if (menuTextMatch && currentMenus.length > 0) {
        currentMenus[currentMenus.length - 1].text = menuTextMatch[1];
      }
      if (routeMatch && currentMenus.length > 0) {
        currentMenus[currentMenus.length - 1].routeName = routeMatch[1];
      }

      // End of menus block
      if (depth < 0) {
        inMenusBlock = false;
        depth = 0;
      }
    }
  }

  // Push last category
  if (currentCategory) {
    categories.push({ ...currentCategory, menus: currentMenus });
  }

  // Filter out deprecated
  return categories
    .filter((category) => { return !category.isDeprecated; })
    .map((category) => {
      return {
        ...category,
        menus: category.menus.filter((menu) => { return !menu.isDeprecated; }),
      };
    });
}

// ============================================================
// --- Route Extractor ---
// ============================================================

function extractRoutes() {
  const filePath = path.join(ADMIN_PATH, 'src/router/path.ts');
  if (!fs.existsSync(filePath)) {
    console.warn('[WARN] path.ts not found:', filePath);
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const routes = [];
  let currentRoute = null;
  let inBreadcrumb = false;
  let breadcrumbNames = [];
  let bracketDepth = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Top-level route path (starts a new route block)
    const pathMatch = trimmed.match(/^path:\s*'([^']+)'/);
    if (pathMatch) {
      // Save previous route
      if (currentRoute && currentRoute.path !== '/') {
        currentRoute.breadcrumbs = breadcrumbNames.length > 0 ? [...breadcrumbNames] : [];
        routes.push(currentRoute);
      }
      currentRoute = { path: pathMatch[1], name: '', category: '', menu: '', breadcrumbs: [] };
      breadcrumbNames = [];
      inBreadcrumb = false;
    }

    if (!currentRoute) {
      continue;
    }

    // Route name
    const nameMatch = trimmed.match(/^name:\s*'([^']+)'/);
    if (nameMatch && !inBreadcrumb) {
      currentRoute.name = nameMatch[1];
    }

    // Category in meta
    const catMatch = trimmed.match(/^category:\s*'([^']+)'/);
    if (catMatch) {
      currentRoute.category = catMatch[1];
    }

    // Menu in meta
    const menuMatch = trimmed.match(/^menu:\s*'([^']+)'/);
    if (menuMatch) {
      currentRoute.menu = menuMatch[1];
    }

    // Breadcrumb block
    if (trimmed.includes('breadCrumbs')) {
      inBreadcrumb = true;
      bracketDepth = 0;
    }

    if (inBreadcrumb) {
      // Count brackets
      for (const char of trimmed) {
        if (char === '[') { bracketDepth++; }
        if (char === ']') { bracketDepth--; }
      }

      // Extract static breadcrumb names (skip template literals with ${})
      const bcNameMatch = trimmed.match(/name:\s*'([^']+)'/);
      if (bcNameMatch) {
        breadcrumbNames.push(bcNameMatch[1]);
      }

      if (bracketDepth <= 0) {
        inBreadcrumb = false;
      }
    }
  }

  // Save last route
  if (currentRoute && currentRoute.path !== '/') {
    currentRoute.breadcrumbs = breadcrumbNames.length > 0 ? [...breadcrumbNames] : [];
    routes.push(currentRoute);
  }

  // Only return routes that have a category (meaningful admin pages)
  const mainRoutes = routes.filter((route) => {
    return route.category && route.path.startsWith('/');
  });

  return { routes: mainRoutes };
}

// ============================================================
// --- Constants Extractor ---
// ============================================================

function extractConstants() {
  const constDir = path.join(ADMIN_PATH, 'src/const');
  if (!fs.existsSync(constDir)) {
    console.warn('[WARN] const directory not found:', constDir);
    return {};
  }

  const result = {};
  const files = fs.readdirSync(constDir).filter((file) => {
    return file.endsWith('.ts');
  });

  for (const file of files) {
    const filePath = path.join(constDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const baseName = file.replace('.ts', '');

    // Extract status option arrays: { name: '...', status: '...' }
    const optionGroups = [];
    const groupRegex = /\/\*\*\s*(.+?)\s*\*\/\s*\nexport const (\w+)[\s\S]*?=\s*\[([\s\S]*?)\]/g;

    let groupMatch;
    while ((groupMatch = groupRegex.exec(content)) !== null) {
      const [, comment, varName, optionsBlock] = groupMatch;
      const options = [];
      const optionRegex = /name:\s*'([^']+)'[\s\S]*?status:\s*'([^']+)'/g;

      let optMatch;
      while ((optMatch = optionRegex.exec(optionsBlock)) !== null) {
        options.push({ name: optMatch[1], status: optMatch[2] });
      }

      // Also try label format
      const labelRegex = /label:\s*'([^']+)'[\s\S]*?(?:type|value):\s*'([^']+)'/g;
      let labelMatch;
      while ((labelMatch = labelRegex.exec(optionsBlock)) !== null) {
        options.push({ name: labelMatch[1], status: labelMatch[2] });
      }

      if (options.length > 0) {
        optionGroups.push({ comment, varName, options });
      }
    }

    // Extract dashboard cards: { type: '...', label: '...' }
    const dashboardRegex = /type:\s*'([^']+)',\s*label:\s*'([^']+)'/g;
    const dashboardCards = [];
    let dashMatch;
    while ((dashMatch = dashboardRegex.exec(content)) !== null) {
      dashboardCards.push({ type: dashMatch[1], label: dashMatch[2] });
    }

    if (optionGroups.length > 0 || dashboardCards.length > 0) {
      result[baseName] = { optionGroups, dashboardCards };
    }
  }

  return result;
}

// ============================================================
// --- Markdown Generator ---
// ============================================================

function generateMarkdown(menus, routeData, constants) {
  const lines = [];

  lines.push('# FastFive Admin 사용 가이드');
  lines.push('');
  lines.push('> 이 파일은 `scripts/generate-knowledge.js`로 자동 생성됩니다.');
  lines.push(`> 마지막 생성: ${new Date().toISOString().split('T')[0]}`);
  lines.push('');

  // ---- Menu Structure ----
  lines.push('---');
  lines.push('');
  lines.push('## 메뉴 구조');
  lines.push('');

  for (const category of menus) {
    lines.push(`### ${category.text}`);
    lines.push('');
    if (category.menus.length > 0) {
      for (const menu of category.menus) {
        lines.push(`- **${menu.text}** (메뉴 ID: ${menu.id})`);
      }
    }
    lines.push('');
  }

  // ---- Route Paths ----
  if (routeData.routes && routeData.routes.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## 주요 화면 경로');
    lines.push('');

    // Group by category
    const byCategory = {};
    for (const route of routeData.routes) {
      const cat = route.category || '기타';
      if (!byCategory[cat]) {
        byCategory[cat] = [];
      }
      byCategory[cat].push(route);
    }

    // Map category names to Korean
    const catNames = {
      entrance: '출입',
      space: '공간',
      reservation: '예약',
      message: '커뮤니케이션',
      user: '사용자',
      contract: '계약',
      'member-service': '멤버서비스',
      accounting: '회계',
      community: '커뮤니티',
    };

    for (const [cat, routes] of Object.entries(byCategory)) {
      const catLabel = catNames[cat] || cat;
      lines.push(`### ${catLabel}`);
      lines.push('');

      // Deduplicate
      const seen = new Set();
      for (const route of routes) {
        if (seen.has(route.path)) {
          continue;
        }
        seen.add(route.path);

        const bcText = route.breadcrumbs.length > 0 ? ` (${route.breadcrumbs.join(' > ')})` : '';
        lines.push(`- \`${route.path}\`${bcText}`);
      }
      lines.push('');
    }
  }

  // ---- Status/Terms ----
  if (Object.keys(constants).length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## 상태값 및 용어');
    lines.push('');

    const constNameMap = {
      'membership-management': '멤버십 관리',
      'renewal-management': '재계약 관리',
      'space-contract-management': '공간 계약 관리',
      'credit-promotion': '크레딧 프로모션',
      'lounge-reservation': '라운지 예약',
      'member-group': '멤버 그룹',
    };

    for (const [fileName, data] of Object.entries(constants)) {
      const sectionName = constNameMap[fileName] || fileName;
      lines.push(`### ${sectionName}`);
      lines.push('');

      for (const group of data.optionGroups) {
        lines.push(`**${group.comment}**`);
        lines.push('');
        lines.push('| 화면 표시 | 내부 상태값 |');
        lines.push('|----------|-----------|');
        for (const option of group.options) {
          lines.push(`| ${option.name} | ${option.status} |`);
        }
        lines.push('');
      }

      if (data.dashboardCards && data.dashboardCards.length > 0) {
        lines.push('**대시보드 카드**');
        lines.push('');
        for (const card of data.dashboardCards) {
          lines.push(`- ${card.label} (\`${card.type}\`)`);
        }
        lines.push('');
      }
    }
  }

  // ---- Permission Groups ----
  lines.push('---');
  lines.push('');
  lines.push('## 권한 그룹 (UserGroup)');
  lines.push('');
  lines.push('| 권한 | 설명 |');
  lines.push('|------|------|');
  lines.push('| SystemAdmin | 시스템 관리자 (모든 기능 접근 가능) |');
  lines.push('| COG-Leader | COG 리더 |');
  lines.push('| COG-Manager | COG 매니저 |');
  lines.push('| CX | CX(고객경험) 팀 |');
  lines.push('| HRManager | HR 매니저 |');
  lines.push('| BusinessManagement | 사업관리 |');
  lines.push('| COSG | COSG |');
  lines.push('| HQ | 본사 |');
  lines.push('| FIVEAD | FIVEAD |');
  lines.push('| BenefitManager | 베네핏 매니저 |');
  lines.push('| OSG-BM | OSG-BM |');
  lines.push('| Marketing | 마케팅 |');
  lines.push('');

  // ---- Manual Section ----
  lines.push('---');
  lines.push('');
  lines.push('## 업무 프로세스 (수동 관리 영역)');
  lines.push('');
  lines.push('> 아래 내용은 코드에서 자동 추출할 수 없는 업무 지식입니다.');
  lines.push('> 필요에 따라 수동으로 추가해주세요.');
  lines.push('');
  lines.push('### 계약 프로세스');
  lines.push('1. 멤버 그룹 생성 → 멤버 추가');
  lines.push('2. 멤버십 계약 생성 → 계약 완료');
  lines.push('3. 부가서비스 계약 (선택)');
  lines.push('4. 출입카드 발급');
  lines.push('');
  lines.push('### 재계약 프로세스');
  lines.push('1. 재계약 관리에서 대상 확인');
  lines.push('2. 제안 전송 (1차 → 2차 → 3차)');
  lines.push('3. 고객 응답 확인');
  lines.push('4. 재계약 또는 퇴주 처리');
  lines.push('');

  return lines.join('\n');
}

// ============================================================
// --- Main ---
// ============================================================

function main() {
  console.log('Admin path:', ADMIN_PATH);
  console.log('Output path:', OUTPUT_PATH);
  console.log('');

  if (!fs.existsSync(ADMIN_PATH)) {
    console.error(`[ERROR] Admin path not found: ${ADMIN_PATH}`);
    console.error('Use --admin-path to specify the correct path.');
    process.exit(1);
  }

  console.log('Extracting menus...');
  const menus = extractMenus();
  console.log(`  Found ${menus.length} categories`);

  console.log('Extracting routes...');
  const routeData = extractRoutes();
  console.log(`  Found ${routeData.routes.length} routes`);

  console.log('Extracting constants...');
  const constants = extractConstants();
  console.log(`  Found ${Object.keys(constants).length} constant files`);

  console.log('');
  console.log('Generating knowledge.md...');
  const markdown = generateMarkdown(menus, routeData, constants);

  fs.writeFileSync(OUTPUT_PATH, markdown, 'utf-8');
  console.log(`Done! Written to ${OUTPUT_PATH}`);
}

main();

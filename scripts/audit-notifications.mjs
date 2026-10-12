import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

// Read-only source audit. This catalog never changes notification behavior.
const root = process.cwd();
function filesIn(directory, extensions) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(filename, extensions) : extensions.some((extension) => filename.endsWith(extension)) ? [filename] : [];
  });
}
const entries = [];
const sourceFiles = filesIn(path.join(root, "src"), [".ts", ".tsx"]).filter((name) => !/\.test\.|\.d\.ts$|[/\\]test[/\\]/.test(name));
const program = ts.createProgram(sourceFiles, { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, skipLibCheck: true, noEmit: true });
const checker = program.getTypeChecker();
for (const filename of sourceFiles) {
  const source = program.getSourceFile(filename);
  const relative = path.relative(root, filename).replaceAll("\\", "/");
  const seen = new Set();
  const compact = (value) => value.replace(/\s+/g, " ").trim();
  function scope(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isFunctionDeclaration(parent) && parent.name) return parent.name.text;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
      if (ts.isJsxAttribute(parent)) return parent.name.getText(source);
    }
    return path.basename(filename);
  }
  function variants(node, depth = 0) {
    if (!node) return [];
    if ([ts.SyntaxKind.NullKeyword, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(node.kind) || ts.isNumericLiteral(node)) return [];
    if (ts.isStringLiteralLike(node)) return node.text ? [node.text] : [];
    if (ts.isTemplateExpression(node)) {
      return [node.head.text + node.templateSpans.map((span) => `{${compact(span.expression.getText(source))}}${span.literal.text}`).join("")];
    }
    if (ts.isConditionalExpression(node)) return [...variants(node.whenTrue, depth + 1), ...variants(node.whenFalse, depth + 1)];
    if (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isAsExpression(node)) return variants(node.expression, depth + 1);
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((element) => variants(element, depth + 1));
    if (ts.isIdentifier(node) && depth < 5) {
      const declaration = (ts.isShorthandPropertyAssignment(node.parent) ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node))?.valueDeclaration;
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && declaration.getSourceFile() === source) return variants(declaration.initializer, depth + 1);
    }
    if (ts.isBinaryExpression(node)) {
      if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return variants(node.right, depth + 1);
      if ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) return [...variants(node.left, depth + 1), ...variants(node.right, depth + 1)];
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      if (ts.isJsxElement(node) && /^(?:button|input|select|svg)$/.test(node.openingElement.tagName.getText(source))) return [];
      return node.children.flatMap((child) => ts.isJsxText(child) ? (compact(child.text) ? [compact(child.text)] : []) : ts.isJsxExpression(child) ? variants(child.expression, depth + 1) : variants(child, depth + 1));
    }
    if (ts.isJsxSelfClosingElement(node)) return [];
    return [`[Dinâmico: ${compact(node.getText(source))}]`];
  }
  function add(node, channel, fields, expression = node.getText(source)) {
    const messages = fields.flatMap(([field, value]) => variants(value).map((text) => ({ field, text: compact(text) }))).filter((message) => message.text && !/^(?:success|error|info|available|downloading|installed|installing)$/.test(message.text));
    if (!messages.length) return;
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const key = `${line}:${JSON.stringify(messages)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const dynamic = messages.some((message) => /\[Dinâmico:|\{.*(?:error|Error|cause|Cause|failure|lastError)/.test(message.text));
    const proposal = channel === "Confirmação" ? "Manter confirmação antes da ação"
      : relative === "src/utils/automaticCalendarSync.ts" ? "Ocultar aviso automático; registrar na EDV"
      : channel === "Erro de helper" ? "Revisar propagação; detalhe técnico na EDV"
      : dynamic ? "Reescrever para o usuário; detalhe técnico na EDV"
      : /(?:nicht sicher gespeichert|Kontakt nicht gespeichert|password|Kennwort|Kennwörter|6-stelligen|Gruppennamen)/i.test(messages.map((message) => message.text).join(" ")) ? "Mostrar de forma contextual se bloquear a ação"
      : "Decidir com o usuário";
    entries.push({ source: relative, line, context: scope(node), channel, messages, dynamic, proposal, decision: "Pendente", expression: compact(expression) });
  }
  function objectFields(object) {
    return object.properties.filter((property) => ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)).filter((property) => /^(?:title|summary|details|message|detail|error|errorMessage)$/.test(property.name.getText(source).replaceAll('"', ""))).map((property) => [property.name.getText(source), ts.isPropertyAssignment(property) ? property.initializer : property.name]);
  }
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      if (/^(?:set\w*(?:Message|Error|Notice|Announcement)|showMessage|onMessage|onFailed|onError)$/.test(callee)) add(node, "Aviso / erro / status", [["message", node.arguments[0]]]);
      if (/^show(?:Import|Export)Result$/.test(callee)) add(node, "Diálogo de resultado", [["title", node.arguments[0]], ["summary", node.arguments[1]], ["details", node.arguments[3]]]);
      if (/^(?:window\.)?(?:alert|confirm)$/.test(callee)) add(node, callee.endsWith("confirm") ? "Confirmação" : "Alerta nativo", [["message", node.arguments[0]]]);
      if (/^(?:setActionResult|recordActivity)$/.test(callee) && node.arguments[0]) {
        const argument = node.arguments[0];
        add(node, callee === "recordActivity" ? "Central de atividades" : "Diálogo de resultado", ts.isObjectLiteralExpression(argument) ? objectFields(argument) : [["result", argument]]);
      }
    }
    if (ts.isNewExpression(node) && node.expression.getText(source) === "Error") add(node, "Erro de helper", [["message", node.arguments?.[0]]]);
    if (ts.isObjectLiteralExpression(node) && !ts.isCallExpression(node.parent)) {
      const fields = objectFields(node);
      if (fields.some(([field]) => /^(?:message|errorMessage)$/.test(field)) || (fields.some(([field]) => field === "detail") && /easyImport/.test(relative))) add(node, "Mensagem produzida / repassada", fields);
    }
    if (ts.isReturnStatement(node) && node.expression) {
      let parent = node.parent;
      while (parent && !ts.isFunctionLike(parent)) parent = parent.parent;
      if (parent?.type?.getText(source).includes("Promise<string>") || /describe.*(?:Failure|Error|Message)/.test(scope(node))) add(node, "Resultado de ação", [["message", node.expression]]);
    }
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(source);
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const attr = (name) => attributes.find((attribute) => attribute.name.getText(source) === name)?.initializer;
      const attrText = (name) => attr(name)?.getText(source) ?? "";
      const notification = /^(?:StatusMessage|ConfirmDialog)$/.test(tag) || /(?:alert|status|note)/.test(attrText("role")) || /(?:error|warning|validation|notice|feedback|status|message|hint|safety|notifier|unsaved|result|summary|progress|success|announcement)/i.test(attrText("className"));
      if (notification) {
        const fields = attributes.filter((attribute) => /^(?:message|title|summary|description)$/.test(attribute.name.getText(source))).map((attribute) => [attribute.name.getText(source), ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : attribute.initializer]);
        const element = ts.isJsxOpeningElement(node) ? node.parent : null;
        if (element && ts.isJsxElement(element)) {
          for (const child of element.children) {
            if (ts.isJsxText(child) && compact(child.text)) fields.push(["text", ts.factory.createStringLiteral(compact(child.text))]);
            else if (ts.isJsxExpression(child) && child.expression) fields.push(["text", child.expression]);
            else if (ts.isJsxElement(child) || ts.isJsxFragment(child)) fields.push(["text", child]);
          }
        }
        add(node, tag === "ConfirmDialog" ? "Confirmação" : "Aviso no formulário / painel", fields);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
entries.sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line);
entries.forEach((entry, index) => { entry.id = `N${String(index + 1).padStart(3, "0")}`; });
const nativeCandidates = [];
for (const filename of filesIn(path.join(root, "src-tauri/src"), [".rs"])) {
  const fullText = fs.readFileSync(filename, "utf8");
  const testModule = fullText.search(/#\[cfg\(test\)\]\s*mod\s+\w*tests\s*\{/);
  const text = testModule >= 0 ? fullText.slice(0, testModule) : fullText;
  const seen = new Set();
  for (const match of text.matchAll(/\b(?:Err|ok_or|ok_or_else|map_err|(?:error_messages|errors|warnings)\.push)\s*\(/g)) {
    const opening = match.index + match[0].length - 1;
    let depth = 0;
    let quote = false;
    let escaped = false;
    let ending = opening;
    for (; ending < text.length; ending++) {
      const character = text[ending];
      if (quote) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quote = false;
      } else if (character === '"') quote = true;
      else if (character === "(") depth++;
      else if (character === ")" && --depth === 0) break;
    }
    for (const literal of text.slice(opening, ending + 1).matchAll(/"(?:\\.|[^"\\])*"/g)) {
      let message;
      try { message = JSON.parse(literal[0]); } catch { message = literal[0].slice(1, -1); }
      if (!/\p{L}{3,}\s+\p{L}/u.test(message) || /^(?:SELECT|UPDATE|DELETE|INSERT|CREATE|ALTER|DROP|PRAGMA|BEGIN|COMMIT|ROLLBACK|Content-Type|GET |POST |HTTP\/|https?:|Bearer )/i.test(message) || seen.has(message)) continue;
      seen.add(message);
      const index = opening + literal.index;
      nativeCandidates.push({ source: path.relative(root, filename).replaceAll("\\", "/"), line: text.slice(0, index).split("\n").length, message, decision: "Pendente; conferir se o fluxo mostra este erro" });
    }
  }
}
nativeCandidates.forEach((entry, index) => { entry.id = `B${String(index + 1).padStart(3, "0")}`; });
const counts = Object.fromEntries([...new Set(entries.map((entry) => entry.source))].map((source) => [source, entries.filter((entry) => entry.source === source).length]));
const audit = {
  generatedAt: new Date().toISOString(),
  scope: "Inventário estático de pontos de mensagem, confirmações e erros em src. Não altera o comportamento do app. Entradas dinâmicas exigem rastrear a origem; respostas externas não têm uma lista finita de textos.",
  total: entries.length,
  counts,
  entries,
  nativeCandidates
};
fs.writeFileSync(path.join(root, "docs/notification-inventory.json"), JSON.stringify(audit, null, 2) + "\n");
const escape = (text) => text.replaceAll("|", "\\|").replaceAll("\n", " ");
let markdown = `# Inventário de mensagens do aplicativo\n\nGerado pelo código atual com \`node scripts/audit-notifications.mjs\`.\n\n**${entries.length} pontos de mensagem** encontrados em **${Object.keys(counts).length} arquivos**. Um ponto pode produzir várias alternativas. Este é um levantamento para classificação, não uma mudança de visibilidade.\n\nAs propostas abaixo **não foram aplicadas**. Todos os itens estão pendentes de decisão. \`{expressão}\` representa valores variáveis; \`[Dinâmico: …]\` significa que o texto depende de outro helper, dados nativos ou resposta externa. Não é possível enumerar todas as frases de servidores, Windows, sistema de arquivos, rede ou extensões. Erros de helpers são candidatos a chegar à interface, e sua propagação deve ser conferida antes de modificar o app. Confirmações e validações foram incluídas porque removê-las indiscriminadamente pode deixar uma ação destrutiva ou bloqueada sem explicação. Rótulos de botões e conteúdo normal das páginas não são notificações.\n\n## Arquivos auditados com mensagens\n\n| Arquivo | Pontos |\n| --- | ---: |\n`;
for (const [source, count] of Object.entries(counts)) markdown += `| ${source} | ${count} |\n`;
for (const source of Object.keys(counts)) {
  markdown += `\n## ${source}\n\n| ID | Onde / contexto | Tipo | Mensagem original ou alternativas | Proposta para discussão | Decisão |\n| --- | --- | --- | --- | --- | --- |\n`;
  for (const entry of entries.filter((entry) => entry.source === source)) {
    const texts = entry.messages.map(({ field, text }) => `**${escape(field)}:** ${escape(text)}`).join("<br>");
    markdown += `| ${entry.id} | L${entry.line} · ${escape(entry.context)} | ${entry.channel} | ${texts} | ${entry.proposal} | Pendente |\n`;
  }
}
fs.writeFileSync(path.join(root, "docs/notification-inventory.md"), markdown);
let nativeMarkdown = `# Textos de erro definidos no backend nativo\n\n${nativeCandidates.length} textos candidatos encontrados em chamadas de erro/aviso do código Rust, antes dos módulos de teste. **Um texto estar aqui não significa que aparece ao usuário.** O frontend pode capturá-lo silenciosamente, exibi-lo na EDV ou concatená-lo em \`String(error)\`. É necessário verificar a propagação antes de aplicar a classificação. Esta lista é auxiliar, não uma contagem de notificações visíveis. Erros externos e mensagens do sistema continuam dinâmicos.\n\n| ID | Fonte | Texto definido no código | Decisão |\n| --- | --- | --- | --- |\n`;
for (const entry of nativeCandidates) nativeMarkdown += `| ${entry.id} | ${entry.source}:L${entry.line} | ${escape(entry.message)} | Pendente |\n`;
fs.writeFileSync(path.join(root, "docs/notification-native-candidates.md"), nativeMarkdown);
console.log(JSON.stringify({ total: entries.length, files: Object.keys(counts).length, nativeCandidates: nativeCandidates.length, counts }, null, 2));

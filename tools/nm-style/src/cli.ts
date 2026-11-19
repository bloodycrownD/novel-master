// 用途：nm-style CLI 入口——子命令分发（check / gate / list / baseline / index）。
// 用法：nm-style <command> [args...]；--help、无参、未知命令打印用法并 exit 2。
// 退出码：0=干净；1=有发现或 gate 新增；2=用法错误；3=构建失败（由 bin 启动器给出）。

const USAGE = `nm-style <command> [args...]

commands:
  check    [--changed | --all | <paths...>] [--strict] [--json] [--include-tests]
  gate     dup | bare
  list     bare --summary | --bucket <桶> | clusters --all  [--json]
  baseline write dup | bare  --baseline <path>
  index    [--json]

exit codes: 0=干净 1=有发现 2=用法错误 3=构建失败`;

const KNOWN_COMMANDS = new Set(["check", "gate", "list", "baseline", "index"]);

function main(): number {
  const args = process.argv.slice(2);
  const command = args.find((arg) => !arg.startsWith("-"));
  if (args.length === 0 || args.includes("--help") || command == null) {
    console.log(USAGE);
    return 2;
  }
  if (!KNOWN_COMMANDS.has(command)) {
    console.error(`nm-style: 未知命令「${command}」\n\n${USAGE}`);
    return 2;
  }
  // 骨架阶段：命令识别先行，规则实现按 spec Step 4-6 逐个接入。
  console.error(`nm-style: 命令「${command}」尚未实现（spec Step 4-6 接入）`);
  return 2;
}

process.exit(main());

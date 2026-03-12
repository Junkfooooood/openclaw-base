import {
  finalizeBoardCard,
  findProjectRoot,
  readJsonFromStdin,
  writeBoardInit,
  writeBoardUpdate
} from "../../shared/runtime/management/task_dispatch_lib.mjs";

function resolveBoardConfig(api) {
  const cfg = api.runtime.config.loadConfig();
  return cfg?.plugins?.entries?.["board-sync"]?.config ?? {};
}

export default function register(api) {
  api.registerCli(
    ({ program }) => {
      const board = program.command("board-sync").description("Manage shared blackboard cards.");

      board.command("init").action(async () => {
        const taskTree = readJsonFromStdin();
        const root = findProjectRoot();
        const target = await writeBoardInit(root, taskTree, resolveBoardConfig(api));
        console.log(
          JSON.stringify(
            {
              status: "initialized",
              task_id: taskTree.task_id,
              card_path: target
            },
            null,
            2
          )
        );
      });

      board.command("update").action(async () => {
        const payload = readJsonFromStdin();
        const root = findProjectRoot();
        const target = await writeBoardUpdate(root, payload, resolveBoardConfig(api));
        console.log(JSON.stringify({ status: "updated", task_id: payload.task_id, card_path: target }, null, 2));
      });

      board.command("finalize").action(async () => {
        const payload = readJsonFromStdin();
        const root = findProjectRoot();
        const result = await finalizeBoardCard(root, payload, resolveBoardConfig(api));
        console.log(
          JSON.stringify(
            {
              status: "archived",
              task_id: payload.task_id,
              card_path: result.archive_path,
              hot_summary_path: result.hot_path
            },
            null,
            2
          )
        );
      });
    },
    { commands: ["board-sync"] }
  );
}

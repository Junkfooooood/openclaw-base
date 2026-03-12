import json
import os
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from shared.bridge.mem0_compat import CompatMemory


def load_env_file(env_file):
    if not env_file:
        return

    path = Path(env_file).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"env file not found: {path}")

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'").strip('"')
        os.environ.setdefault(key, value)


def read_payload():
    raw = sys.stdin.read().strip()
    return json.loads(raw) if raw else {}


def write_result(payload, exit_code=0):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2))
    sys.stdout.write("\n")
    raise SystemExit(exit_code)


def require_value(value, message):
    if value in (None, ""):
        raise ValueError(message)
    return value


def build_mem0_config(payload):
    bridge_config = payload.get("bridge_config") or {}
    qdrant_url = bridge_config.get("qdrantUrl") or os.environ.get("QDRANT_URL") or "http://127.0.0.1:6333"
    collection_name = (
        bridge_config.get("collectionName")
        or os.environ.get("MEM0_COLLECTION_NAME")
        or "openclaw_memory"
    )
    embedding_dims = int(
        bridge_config.get("embeddingModelDims")
        or os.environ.get("MEM0_EMBEDDING_DIMS")
        or 1536
    )
    llm_model = bridge_config.get("llmModel") or os.environ.get("MEM0_LLM_MODEL") or "gpt-4.1-mini"
    embedder_model = (
        bridge_config.get("embedderModel")
        or os.environ.get("MEM0_EMBEDDER_MODEL")
        or "text-embedding-3-small"
    )
    openai_api_key = require_value(
        bridge_config.get("openaiApiKey") or os.environ.get("OPENAI_API_KEY"),
        "OPENAI_API_KEY is required for mem0 bridge operations",
    )

    enable_graph = bridge_config.get("enableGraph", True)
    neo4j_url = (
        bridge_config.get("neo4jUrl")
        or os.environ.get("NEO4J_URI")
        or os.environ.get("NEO4J_URL")
    )
    neo4j_username = bridge_config.get("neo4jUsername") or os.environ.get("NEO4J_USERNAME") or "neo4j"
    neo4j_password = bridge_config.get("neo4jPassword") or os.environ.get("NEO4J_PASSWORD")
    neo4j_database = bridge_config.get("neo4jDatabase") or os.environ.get("NEO4J_DATABASE") or "neo4j"
    history_db_path = (
        bridge_config.get("historyDbPath")
        or os.environ.get("MEM0_HISTORY_DB_PATH")
        or str(ROOT / "shared" / "runtime" / "memory" / "mem0_history.db")
    )
    Path(history_db_path).expanduser().parent.mkdir(parents=True, exist_ok=True)

    config = {
        "vector_store": {
            "provider": "qdrant",
            "config": {
                "url": qdrant_url,
                "collection_name": collection_name,
                "embedding_model_dims": embedding_dims,
            },
        },
        "llm": {
            "provider": "openai",
            "config": {
                "api_key": openai_api_key,
                "model": llm_model,
                "temperature": 0.1,
            },
        },
        "embedder": {
            "provider": "openai",
            "config": {
                "api_key": openai_api_key,
                "model": embedder_model,
            },
        },
        "history_db_path": str(Path(history_db_path).expanduser()),
    }

    if enable_graph:
        config["graph_store"] = {
            "provider": "neo4j",
            "config": {
                "url": require_value(neo4j_url, "NEO4J_URL or NEO4J_URI is required when graph is enabled"),
                "username": require_value(neo4j_username, "NEO4J_USERNAME is required when graph is enabled"),
                "password": require_value(neo4j_password, "NEO4J_PASSWORD is required when graph is enabled"),
                "database": neo4j_database,
            },
        }

    return config


def create_memory(payload):
    env_file = payload.get("env_file")
    if env_file:
        load_env_file(env_file)
    return CompatMemory.from_config(build_mem0_config(payload))


def build_messages(payload):
    messages = payload.get("messages")
    if messages:
        return messages

    text = (payload.get("text") or "").strip()
    if not text:
        raise ValueError("text or messages is required")

    acknowledgement = payload.get("acknowledgement") or "已记录该候选记忆。"
    return [
        {"role": "user", "content": text},
        {"role": "assistant", "content": acknowledgement},
    ]


def run_health(payload):
    env_file = payload.get("env_file")
    if env_file:
        load_env_file(env_file)

    config = build_mem0_config(payload)
    memory = CompatMemory.from_config(config)
    return {
        "status": "ok",
        "compat_memory": type(memory).__name__,
        "graph_backend": type(memory.graph).__name__ if getattr(memory, "graph", None) else None,
        "graph_enabled": bool(getattr(memory, "enable_graph", False)),
        "collection_name": memory.collection_name,
        "qdrant_url": config["vector_store"]["config"]["url"],
        "neo4j_url": config.get("graph_store", {}).get("config", {}).get("url"),
    }


def run_search(payload):
    memory = create_memory(payload)
    query = require_value(payload.get("query"), "query is required")
    user_id = require_value(payload.get("user_id"), "user_id is required")
    limit = int(payload.get("limit") or 5)
    threshold = payload.get("threshold")

    result = memory.search(
        query,
        user_id=user_id,
        limit=limit,
        threshold=threshold,
    )
    return {
        "status": "ok",
        "query": query,
        "user_id": user_id,
        "data": result,
    }


def run_add(payload):
    memory = create_memory(payload)
    messages = build_messages(payload)
    user_id = require_value(payload.get("user_id"), "user_id is required")
    result = memory.add(
        messages,
        user_id=user_id,
        metadata=payload.get("metadata"),
        infer=payload.get("infer", True),
    )
    return {
        "status": "ok",
        "user_id": user_id,
        "data": result,
    }


def run_smoke(payload):
    user_id = payload.get("user_id") or "lin-main"
    unique_tag = f"openclaw-smoke-{int(time.time())}"
    text = payload.get("text") or f"{unique_tag}：学习系统包含日志、知识库、任务、六维能力、声望、战略。"

    add_payload = {
        **payload,
        "text": text,
        "user_id": user_id,
        "acknowledgement": "已记录 smoke test 记忆。",
    }
    add_result = run_add(add_payload)
    search_result = run_search(
        {
            **payload,
            "query": "学习系统有哪些板块？",
            "user_id": user_id,
            "limit": payload.get("limit") or 5,
        }
    )
    return {
        "status": "ok",
        "smoke_tag": unique_tag,
        "add": add_result["data"],
        "search": search_result["data"],
    }


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "health"
    payload = read_payload()

    handlers = {
        "health": run_health,
        "search": run_search,
        "add": run_add,
        "smoke": run_smoke,
    }

    if command not in handlers:
        write_result({"status": "error", "error": f"unsupported command: {command}"}, exit_code=2)

    try:
        result = handlers[command](payload)
        write_result(result)
    except Exception as exc:
        write_result(
            {
                "status": "error",
                "command": command,
                "error": str(exc),
                "error_type": type(exc).__name__,
            },
            exit_code=1,
        )


if __name__ == "__main__":
    main()

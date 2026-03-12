import os
from copy import deepcopy

from mem0 import Memory as UpstreamMemory
from mem0.configs.base import MemoryConfig
from mem0.memory.graph_memory import (
    EmbedderFactory,
    LlmFactory,
    MemoryGraph as UpstreamMemoryGraph,
    Neo4jGraph,
)
from mem0.utils.factory import GraphStoreFactory


def _first_non_empty(*values):
    for value in values:
        if value not in (None, ""):
            return value
    return None


class CompatNeo4jMemoryGraph(UpstreamMemoryGraph):
    """
    Mem0 1.0.5 still constructs Neo4jGraph with positional args that no longer match
    langchain_neo4j 0.7.x. This adapter keeps the rest of Mem0's graph behavior and
    only fixes graph initialization by using explicit keyword arguments.
    """

    def __init__(self, config):
        self.config = config
        graph_config = self.config.graph_store.config

        url = _first_non_empty(
            getattr(graph_config, "url", None),
            os.environ.get("NEO4J_URI"),
            os.environ.get("NEO4J_URL"),
            "bolt://127.0.0.1:7687",
        )
        username = _first_non_empty(
            getattr(graph_config, "username", None),
            os.environ.get("NEO4J_USERNAME"),
            "neo4j",
        )
        password = _first_non_empty(
            getattr(graph_config, "password", None),
            os.environ.get("NEO4J_PASSWORD"),
        )
        database = _first_non_empty(
            getattr(graph_config, "database", None),
            os.environ.get("NEO4J_DATABASE"),
            "neo4j",
        )

        self.graph = Neo4jGraph(
            url=url,
            username=username,
            password=password,
            database=database,
            refresh_schema=False,
            driver_config={"notifications_min_severity": "OFF"},
        )
        self.embedding_model = EmbedderFactory.create(
            self.config.embedder.provider,
            self.config.embedder.config,
            self.config.vector_store.config,
        )
        self.node_label = ":`__Entity__`" if graph_config.base_label else ""

        if graph_config.base_label:
            try:
                self.graph.query(
                    f"CREATE INDEX entity_single IF NOT EXISTS FOR (n {self.node_label}) ON (n.user_id)"
                )
            except Exception:
                pass
            try:
                self.graph.query(
                    f"CREATE INDEX entity_composite IF NOT EXISTS FOR (n {self.node_label}) ON (n.name, n.user_id)"
                )
            except Exception:
                pass

        self.llm_provider = "openai"
        if self.config.llm and self.config.llm.provider:
            self.llm_provider = self.config.llm.provider
        if self.config.graph_store and self.config.graph_store.llm and self.config.graph_store.llm.provider:
            self.llm_provider = self.config.graph_store.llm.provider

        llm_config = None
        if self.config.graph_store and self.config.graph_store.llm and hasattr(self.config.graph_store.llm, "config"):
            llm_config = self.config.graph_store.llm.config
        elif hasattr(self.config.llm, "config"):
            llm_config = self.config.llm.config

        self.llm = LlmFactory.create(self.llm_provider, llm_config)
        self.user_id = None
        self.threshold = (
            self.config.graph_store.threshold
            if hasattr(self.config.graph_store, "threshold")
            else 0.7
        )


class CompatMemory(UpstreamMemory):
    """
    Wrapper around mem0.Memory that disables upstream graph bootstrap, then
    reattaches a compatible graph layer for Neo4j.
    """

    def __init__(self, config: MemoryConfig = MemoryConfig()):
        original_config = config
        bootstrap_config = (
            original_config.model_copy(deep=True)
            if hasattr(original_config, "model_copy")
            else deepcopy(original_config)
        )

        graph_store = getattr(bootstrap_config, "graph_store", None)
        has_graph = bool(getattr(graph_store, "config", None))
        if has_graph:
            bootstrap_config.graph_store = (
                bootstrap_config.graph_store.model_copy(deep=True)
                if hasattr(bootstrap_config.graph_store, "model_copy")
                else deepcopy(bootstrap_config.graph_store)
            )
            bootstrap_config.graph_store.config = None

        super().__init__(bootstrap_config)

        self.config = original_config
        self.graph = None
        self.enable_graph = False

        if getattr(original_config.graph_store, "config", None):
            provider = original_config.graph_store.provider
            if provider == "neo4j":
                self.graph = CompatNeo4jMemoryGraph(original_config)
            else:
                self.graph = GraphStoreFactory.create(provider, original_config)
            self.enable_graph = True

    @classmethod
    def from_config(cls, config_dict):
        cls._process_config(config_dict)
        return cls(MemoryConfig(**config_dict))

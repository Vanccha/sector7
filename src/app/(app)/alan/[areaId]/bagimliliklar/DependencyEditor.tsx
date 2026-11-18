"use client";
import { useCallback, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { isTicketEditable, TICKET_STATUS_LABELS, type TicketStatus } from "@/lib/contracts/plan";
import { addDependencyAction, removeDependencyAction, setTicketPositionAction } from "./actions";
import type { DependencyProps } from "./DependencyWorkspace";
import styles from "./Dependency.module.css";

type TicketNodeData = {
  title: string;
  status: TicketStatus;
  areaName: string | null; // yalnız dış düğümlerde
  takeable: boolean;
  blocked: boolean;
  external: boolean;
};
type TicketNode = Node<TicketNodeData, "ticket">;

const COL_W = 300;
const ROW_H = 120;

function TicketNodeView({ data }: NodeProps<TicketNode>) {
  const state = data.external
    ? "Başka alan"
    : data.takeable
      ? "Alınabilir"
      : data.blocked
        ? "Kilitli"
        : TICKET_STATUS_LABELS[data.status];
  return (
    <div className={styles.node}>
      {!data.external && <Handle type="target" position={Position.Left} />}
      <div
        className={styles.nodeBody}
        data-takeable={data.takeable}
        data-blocked={data.blocked}
        data-external={data.external}
      >
        {data.areaName && <span className={styles.nodeArea}>{data.areaName}</span>}
        <span className={styles.nodeTitle}>{data.title}</span>
        <span className={styles.nodeMeta}>
          {TICKET_STATUS_LABELS[data.status]}
          {state !== TICKET_STATUS_LABELS[data.status] ? ` · ${state}` : ""}
        </span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { ticket: TicketNodeView };

const edgeId = (dependsOnId: string, ticketId: string) => `${dependsOnId}->${ticketId}`;

function buildEdges({ tickets, externalPrerequisites }: DependencyProps): Edge[] {
  const ids = new Set([...tickets.filter((t) => t.status !== "cancelled").map((t) => t.id), ...externalPrerequisites.map((e) => e.id)]);
  const external = new Set(externalPrerequisites.map((e) => e.id));
  const edges: Edge[] = [];
  for (const t of tickets) {
    if (t.status === "cancelled") continue;
    for (const p of t.prerequisites) {
      if (!ids.has(p.id)) continue;
      edges.push({
        id: edgeId(p.id, t.id),
        source: p.id,
        target: t.id,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: external.has(p.id) ? { strokeDasharray: "6 4" } : undefined,
      });
    }
  }
  return edges;
}

function buildNodes(props: DependencyProps, edges: Edge[], prev: Map<string, { x: number; y: number }>): TicketNode[] {
  const own = props.tickets.filter((t) => t.status !== "cancelled");
  const ids = [...own.map((t) => t.id), ...props.externalPrerequisites.map((e) => e.id)];
  // Topolojik derinlik: ön koşulsuz düğümler 0. sütunda.
  const prereqsOf = new Map<string, string[]>();
  for (const e of edges) prereqsOf.set(e.target, [...(prereqsOf.get(e.target) ?? []), e.source]);
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = Math.max(-1, ...(prereqsOf.get(id) ?? []).map(depthOf)) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  const rowInCol = new Map<number, number>();
  const auto = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const d = depthOf(id);
    const r = rowInCol.get(d) ?? 0;
    rowInCol.set(d, r + 1);
    auto.set(id, { x: d * COL_W, y: r * ROW_H });
  }
  const nodes: TicketNode[] = own.map((t) => ({
    id: t.id,
    type: "ticket",
    position: prev.get(t.id) ?? (t.posX !== null && t.posY !== null ? { x: t.posX, y: t.posY } : auto.get(t.id)!),
    draggable: props.canEdit,
    data: {
      title: t.title,
      status: t.status,
      areaName: null,
      takeable: t.takeable,
      blocked: t.blockedBy.length > 0,
      external: false,
    },
  }));
  for (const e of props.externalPrerequisites) {
    nodes.push({
      id: e.id,
      type: "ticket",
      position: prev.get(e.id) ?? auto.get(e.id)!,
      draggable: false,
      connectable: true,
      deletable: false,
      data: { title: e.title, status: e.status, areaName: e.areaName, takeable: false, blocked: false, external: true },
    });
  }
  return nodes;
}

export function DependencyEditor(props: DependencyProps) {
  const { tickets, canEdit } = props;
  const [initial] = useState(() => {
    const e = buildEdges(props);
    return { edges: e, nodes: buildNodes(props, e, new Map()) };
  });
  const [nodes, setNodes, onNodesChange] = useNodesState<TicketNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [synced, setSynced] = useState(props);
  const [error, setError] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  // Sunucudan yeni veri gelince düğüm konumlarını koruyarak yeniden kur.
  if (synced.tickets !== tickets || synced.externalPrerequisites !== props.externalPrerequisites) {
    setSynced(props);
    const e = buildEdges(props);
    setEdges(e);
    setNodes(buildNodes(props, e, new Map(nodes.map((n) => [n.id, n.position]))));
  }

  const byId = new Map(tickets.map((t) => [t.id, t]));
  const canTarget = (id: string) => {
    const t = byId.get(id);
    return !!t && isTicketEditable(t.status);
  };

  const isValidConnection = useCallback(
    (c: Connection | Edge) => c.source !== c.target && canEdit && canTarget(c.target),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [canEdit, tickets],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return;
      const id = edgeId(c.source, c.target);
      if (edges.some((e) => e.id === id)) return;
      setError(null);
      setEdges((es) => [...es, { id, source: c.source, target: c.target, markerEnd: { type: MarkerType.ArrowClosed } }]);
      void addDependencyAction({ ticketId: c.target, dependsOnId: c.source }).then((res) => {
        if (!res.ok) {
          setEdges((es) => es.filter((e) => e.id !== id));
          setError(res.error);
        }
      });
    },
    [edges, setEdges],
  );

  const removeEdges = useCallback(
    (removed: Edge[]) => {
      setError(null);
      setSelectedEdge(null);
      for (const e of removed) {
        void removeDependencyAction({ ticketId: e.target, dependsOnId: e.source }).then((res) => {
          if (!res.ok) {
            setEdges((es) => (es.some((x) => x.id === e.id) ? es : [...es, e]));
            setError(res.error);
          }
        });
      }
    },
    [setEdges],
  );

  return (
    <>
      <p className={styles.help}>Bir ticket&apos;ın sağındaki noktadan, onu bekleyecek ticket&apos;ın soluna sürükle.</p>
      <div className={styles.flowWrap}>
        {error && (
          <p className={`notice notice--hot ${styles.error}`} role="alert">
            {error}
          </p>
        )}
        <ReactFlow<TicketNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onEdgesDelete={removeEdges}
          onEdgeClick={(_, e) => setSelectedEdge(e.id)}
          onPaneClick={() => setSelectedEdge(null)}
          onNodeDragStop={(_, n) => {
            if (!canEdit || n.data.external) return;
            void setTicketPositionAction({ ticketId: n.id, x: n.position.x, y: n.position.y });
          }}
          nodesDraggable={canEdit}
          nodesConnectable={canEdit}
          edgesFocusable={canEdit}
          elementsSelectable={canEdit}
          deleteKeyCode={canEdit ? ["Backspace", "Delete"] : null}
          colorMode="dark"
          fitView
          minZoom={0.2}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
        {canEdit && selectedEdge && edges.some((e) => e.id === selectedEdge) && (
          <div className={styles.edgeBar}>
            <button
              type="button"
              className="btn-line btn-danger"
              onClick={() => {
                const e = edges.find((x) => x.id === selectedEdge);
                if (!e) return;
                setEdges((es) => es.filter((x) => x.id !== e.id));
                removeEdges([e]);
              }}
            >
              Bağlantıyı kaldır
            </button>
          </div>
        )}
      </div>
      {!canEdit && <p className="muted">Bu sprintin planı salt okunur; bağlantılar değiştirilemez.</p>}
    </>
  );
}

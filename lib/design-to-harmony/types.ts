export type DesignSourceProvider = "figma";

export type DesignNodeType =
  | "DOCUMENT"
  | "CANVAS"
  | "SECTION"
  | "FRAME"
  | "GROUP"
  | "COMPONENT"
  | "COMPONENT_SET"
  | "INSTANCE"
  | "TEXT"
  | "VECTOR"
  | "RECTANGLE"
  | "ELLIPSE"
  | "LINE"
  | "STAR"
  | "POLYGON"
  | "BOOLEAN_OPERATION"
  | "SLICE"
  | "STAMP"
  | "HIGHLIGHT"
  | "WASHI_TAPE"
  | "SHAPE_WITH_TEXT"
  | "CODE_BLOCK"
  | "CONNECTOR"
  | "WIDGET"
  | "EMBED"
  | "LINK_UNFURL"
  | "MEDIA"
  | "UNKNOWN";

export interface DesignSourceRef {
  provider: DesignSourceProvider;
  fileKey: string;
  nodeId?: string;
  url: string;
  displayName?: string;
}

export interface DesignSourceVersion {
  id: string;
  lastModified: string;
}

export interface DesignTreeNodeSummary {
  id: string;
  name: string;
  type: DesignNodeType;
  visible: boolean;
  childCount: number;
  children: DesignTreeNodeSummary[];
}

export interface DesignFlowSummary {
  id: string;
  name: string;
  nodeId: string;
  pageId: string;
}

export interface DesignComponentSummary {
  nodeId: string;
  key?: string;
  name: string;
  description?: string;
  componentSetId?: string;
}

export interface DesignStyleSummary {
  nodeId: string;
  key?: string;
  name: string;
  styleType?: string;
  description?: string;
}

export interface DesignVariableCollectionSummary {
  id: string;
  key?: string;
  name: string;
  modes: Array<{ id: string; name: string }>;
  variableIds: string[];
}

export interface DesignVariableSummary {
  id: string;
  key?: string;
  name: string;
  collectionId: string;
  resolvedType: "BOOLEAN" | "FLOAT" | "STRING" | "COLOR" | "UNKNOWN";
  remote: boolean;
  description?: string;
}

export interface DesignVariableCatalog {
  availability: "available" | "unavailable" | "not_requested";
  collections: DesignVariableCollectionSummary[];
  variables: DesignVariableSummary[];
  reason?: string;
}

export interface DesignDocumentSummary {
  rootId: string;
  name: string;
  version: DesignSourceVersion;
  editorType?: string;
  thumbnailUrl?: string;
  pages: DesignTreeNodeSummary[];
  components: DesignComponentSummary[];
  componentSets: DesignComponentSummary[];
  styles: DesignStyleSummary[];
  variables: DesignVariableCatalog;
  flows: DesignFlowSummary[];
  counts: {
    pages: number;
    topLevelNodes: number;
    components: number;
    componentSets: number;
    styles: number;
    variables: number;
    flows: number;
  };
  warnings: string[];
}

export interface DesignSourceNodePayload {
  id: string;
  document: Record<string, unknown>;
}

export type DesignIrNodeKind =
  | "page"
  | "container"
  | "component"
  | "component_set"
  | "instance"
  | "text"
  | "shape"
  | "vector"
  | "image"
  | "unknown";

export interface DesignIrPaint {
  type: "solid" | "gradient" | "image" | "unknown";
  visible: boolean;
  opacity: number;
  color?: { red: number; green: number; blue: number; alpha: number };
  imageRef?: string;
  variableId?: string;
}

export interface DesignIrLayout {
  mode: "none" | "row" | "column";
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  gap: number;
  padding: { top: number; right: number; bottom: number; left: number };
  primarySizing: "fixed" | "hug" | "fill" | "unknown";
  counterSizing: "fixed" | "hug" | "fill" | "unknown";
  primaryAlign: "start" | "center" | "end" | "space_between" | "unknown";
  counterAlign: "start" | "center" | "end" | "baseline" | "unknown";
  absolute: boolean;
  clipsContent: boolean;
}

export interface DesignIrTextStyle {
  characters: string;
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeightPx?: number;
  letterSpacing?: number;
  textAlign: "start" | "center" | "end" | "justified" | "unknown";
}

export interface DesignIrNode {
  id: string;
  sourceId: string;
  sourcePath: string[];
  name: string;
  sourceType: DesignNodeType;
  kind: DesignIrNodeKind;
  visible: boolean;
  layout: DesignIrLayout;
  opacity: number;
  blendMode: string;
  cornerRadius?: number;
  fills: DesignIrPaint[];
  strokes: DesignIrPaint[];
  effects: string[];
  text?: DesignIrTextStyle;
  componentId?: string;
  variableIds: string[];
  imageRefs: string[];
  interactionTargetIds: string[];
  children: DesignIrNode[];
}

export interface NormalizedDesignIR {
  schemaVersion: 1;
  sourceImportId: string;
  sourceVersion: string;
  targetNodeIds: string[];
  roots: DesignIrNode[];
  nodeCount: number;
  hash: string;
}

export type DesignIssueSeverity = "blocking" | "confirmation" | "reminder";

export interface DesignPlanIssue {
  id: string;
  severity: DesignIssueSeverity;
  code: string;
  title: string;
  message: string;
  sourceNodeIds: string[];
  suggestedResolution?: string;
}

export interface HarmonyProjectComponent {
  name: string;
  relativePath: string;
}

export interface HarmonyProjectModule {
  name: string;
  relativePath: string;
  sourceRoot?: string;
  resourceRoot?: string;
  components: HarmonyProjectComponent[];
}

export interface HarmonyProjectInventory {
  schemaVersion: 1;
  projectRoot: string;
  modules: HarmonyProjectModule[];
  selectedModule?: string;
  scannedFiles: number;
  truncated: boolean;
}

export interface DesignDependencyClosure {
  componentNodeIds: string[];
  variableIds: string[];
  assetRefs: string[];
  interactionNodeIds: string[];
}

export interface HarmonyComponentMapping {
  sourceNodeId: string;
  sourceName: string;
  strategy: "project_component" | "arkui_native" | "generate_component";
  targetName: string;
  targetPath?: string;
  confidence: "exact" | "inferred" | "fallback";
}

export interface HarmonyVariableMapping {
  variableId: string;
  sourceName: string;
  resolvedType: DesignVariableSummary["resolvedType"];
  resourceType: "color" | "float" | "string" | "boolean" | "unknown";
  resourceName: string;
  arkuiReference: string;
}

export interface HarmonyInteractionMapping {
  sourceNodeId: string;
  targetNodeId: string;
  strategy: "router_push" | "dialog" | "state_change" | "placeholder";
  handlerName: string;
}

export interface HarmonyFilePlan {
  sourceNodeId: string;
  sourceName: string;
  relativePath: string;
  symbolName: string;
  rootComponent: "Row" | "Column" | "Stack" | "Text" | "Image" | "Shape";
}

export interface HarmonyUiPlan {
  schemaVersion: 1;
  id: string;
  sourceImportId: string;
  sourceVersion: string;
  projectRoot: string;
  targetNodeIds: string[];
  targetModule?: string;
  dependencies: DesignDependencyClosure;
  files: HarmonyFilePlan[];
  componentMappings: HarmonyComponentMapping[];
  variableMappings: HarmonyVariableMapping[];
  interactionMappings: HarmonyInteractionMapping[];
  issues: DesignPlanIssue[];
  stats: {
    irNodes: number;
    outputFiles: number;
    blockingIssues: number;
    confirmationIssues: number;
    reminders: number;
  };
  irHash: string;
  hash: string;
}

export interface DesignAnalysisRun {
  schemaVersion: 1;
  id: string;
  projectRoot: string;
  importId: string;
  sourceVersion: string;
  targetNodeIds: string[];
  status: "planned" | "failed" | "interrupted";
  revision: number;
  createdAt: string;
  updatedAt: string;
  plan?: HarmonyUiPlan;
  error?: { code: string; message: string; retryable: boolean };
}

export interface DesignAnalysisResponse {
  run: DesignAnalysisRun;
  cached: boolean;
}

export interface DesignAssetRequest {
  nodeId: string;
  format: "png" | "jpg" | "svg" | "pdf";
  scale?: number;
}

export interface DesignAssetResult {
  nodeId: string;
  url: string | null;
}

export interface DesignReferenceRender {
  nodeId: string;
  url: string | null;
}

export interface DesignImportRecord {
  schemaVersion: 1;
  id: string;
  projectRoot: string;
  source: DesignSourceRef;
  document: DesignDocumentSummary;
  importedAt: string;
  updatedAt: string;
}

export interface DesignCredentialStatus {
  provider: DesignSourceProvider;
  configured: boolean;
  updatedAt?: string;
}

export interface DesignImportListResponse {
  imports: DesignImportRecord[];
}

export interface DesignImportResponse {
  record: DesignImportRecord;
  cached: boolean;
}

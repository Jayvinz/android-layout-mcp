package aui;

import com.android.tools.idea.io.grpc.ManagedChannel;
import com.android.tools.idea.io.grpc.ManagedChannelBuilder;
import com.android.tools.idea.layoutinspector.view.inspection.LayoutInspectorViewProtocol;
import com.android.tools.profiler.proto.Transport;
import com.android.tools.profiler.proto.TransportServiceGrpc;
import com.android.tools.profiler.proto.Commands;
import com.android.tools.profiler.proto.Common;
import com.android.tools.app.inspection.AppInspection;
import layoutinspector.compose.inspection.LayoutInspectorComposeProtocol;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

/**
 * Standalone bridge that drives Android Studio's transport daemon + JVMTI agents to retrieve the
 * Compose layout tree. All protobuf/gRPC classes are taken from the local Android Studio install.
 *
 * Arguments:
 *   --port <gRPC port forwarded to the device daemon>
 *   --stream-id <device id used by the transport>
 *   --pid <app pid>
 *   --package <app package>
 *   --view-dex <absolute path to layoutinspector-view-inspection.jar in app code_cache>
 *   --compose-dex <absolute path to compose inspector jar in app code_cache>
 *   --agent-lib <libjvmtiagent_<abi>.so file name>
 *   --agent-config <absolute path to agent.config on device>
 *   --dispose <true|false> (default true)
 */
public final class ComposeInspectorHelper {
  private static final long ROOT_WAIT_MS = 10_000;
  private static final long RESPONSE_WAIT_MS = 12_000;

  private final TransportServiceGrpc.TransportServiceBlockingStub stub;
  private final long streamId;
  private final int pid;
  private final String packageName;
  private final String viewDex;
  private final String composeDex;
  private final String agentLib;
  private final String agentConfig;
  private final boolean disposeInspectors;

  private volatile boolean running = true;
  private volatile long rootViewId = -1;
  private final Map<Long, ByteArrayOutputStream> chunks = new ConcurrentHashMap<>();
  private final Map<Long, Integer> payloadCommandIds = new ConcurrentHashMap<>();
  private final int composeCommandId = 10_000 + new Random().nextInt(1_000_000);
  private final int parameterCommandId = composeCommandId + 1;
  private final BlockingQueue<LayoutInspectorComposeProtocol.GetComposablesResponse> composeResponses =
      new LinkedBlockingQueue<>();
  private final BlockingQueue<LayoutInspectorComposeProtocol.GetAllParametersResponse> parameterResponses =
      new LinkedBlockingQueue<>();
  private final Map<Long, Map<String, String>> parametersByNode = new HashMap<>();
  private final List<String> warnings = new ArrayList<>();
  private Thread listener;

  private ComposeInspectorHelper(
      ManagedChannel channel,
      long streamId,
      int pid,
      String packageName,
      String viewDex,
      String composeDex,
      String agentLib,
      String agentConfig,
      boolean disposeInspectors) {
    this.stub = TransportServiceGrpc.newBlockingStub(channel);
    this.streamId = streamId;
    this.pid = pid;
    this.packageName = packageName;
    this.viewDex = viewDex;
    this.composeDex = composeDex;
    this.agentLib = agentLib;
    this.agentConfig = agentConfig;
    this.disposeInspectors = disposeInspectors;
  }

  public static void main(String[] args) {
    Map<String, String> parsed = parseArgs(args);
    try {
      long port = Long.parseLong(parsed.getOrDefault("--port", "0"));
      long streamId = Long.parseLong(parsed.getOrDefault("--stream-id", "0"));
      int pid = Integer.parseInt(parsed.getOrDefault("--pid", "0"));
      String pkg = parsed.get("--package");
      String viewDex = parsed.get("--view-dex");
      String composeDex = parsed.get("--compose-dex");
      String agentLib = parsed.getOrDefault("--agent-lib", "libjvmtiagent_arm64-v8a.so");
      String agentConfig = parsed.getOrDefault("--agent-config", "/data/local/tmp/perfd/agent.config");
      boolean dispose = !"false".equalsIgnoreCase(parsed.getOrDefault("--dispose", "true"));
      if (port <= 0 || streamId == 0 || pid <= 0 || pkg == null || viewDex == null || composeDex == null) {
        fail("missing required arguments");
        return;
      }
      ManagedChannel channel = ManagedChannelBuilder.forAddress("127.0.0.1", (int) port).usePlaintext().build();
      ComposeInspectorHelper helper = new ComposeInspectorHelper(
          channel, streamId, pid, pkg, viewDex, composeDex, agentLib, agentConfig, dispose);
      try {
        helper.run();
      } finally {
        helper.stopListener();
        channel.shutdownNow();
      }
    } catch (Throwable t) {
      fail(t.toString());
    }
  }

  private void run() throws Exception {
    startListener();
    log("connected");
    attachAgent();
    createViewInspector();
    // continuous=false forces SKP capture (78MB on a 256MB heap) and OOMs the app. Keep it
    // continuous=true, disable bitmap screenshots, and set type NONE so the capture buffer stays
    // empty while we only need the root view id.
    sendViewRaw(10, LayoutInspectorViewProtocol.Command.newBuilder()
        .setEnableBitmapScreenshotCommand(LayoutInspectorViewProtocol.EnableBitmapScreenshotCommand.newBuilder().setEnable(false))
        .build().toByteArray());
    sendViewRaw(11, LayoutInspectorViewProtocol.Command.newBuilder()
        .setUpdateScreenshotTypeCommand(LayoutInspectorViewProtocol.UpdateScreenshotTypeCommand.newBuilder()
            .setType(LayoutInspectorViewProtocol.Screenshot.Type.NONE).setScale(0.1f))
        .build().toByteArray());
    Thread.sleep(300);
    sendViewRaw(20, LayoutInspectorViewProtocol.Command.newBuilder()
        .setStartFetchCommand(LayoutInspectorViewProtocol.StartFetchCommand.newBuilder().setContinuous(true))
        .build().toByteArray());
    log("waiting for root view id");
    long deadline = System.currentTimeMillis() + ROOT_WAIT_MS;
    while (rootViewId < 0 && System.currentTimeMillis() < deadline) Thread.sleep(100);
    if (rootViewId < 0) {
      throw new IllegalStateException("view inspector did not report a root view id");
    }
    log("root view id " + rootViewId);
    sendViewRaw(21, LayoutInspectorViewProtocol.Command.newBuilder()
        .setStopFetchCommand(LayoutInspectorViewProtocol.StopFetchCommand.newBuilder())
        .build().toByteArray());
    Thread.sleep(400);

    createComposeInspector();
    Thread.sleep(1200);

    sendComposeRaw(composeCommandId, LayoutInspectorComposeProtocol.Command.newBuilder()
        .setGetComposablesCommand(LayoutInspectorComposeProtocol.GetComposablesCommand.newBuilder()
            .setRootViewId(rootViewId))
        .build().toByteArray());
    log("waiting for compose tree");
    LayoutInspectorComposeProtocol.GetComposablesResponse response =
        composeResponses.poll(RESPONSE_WAIT_MS, TimeUnit.MILLISECONDS);
    if (response == null) {
      throw new IllegalStateException("compose inspector did not return a tree");
    }
    // Parameters give us text/contentDescription labels that are not present in the tree itself.
    sendComposeRaw(parameterCommandId, LayoutInspectorComposeProtocol.Command.newBuilder()
        .setGetAllParametersCommand(LayoutInspectorComposeProtocol.GetAllParametersCommand.newBuilder()
            .setRootViewId(rootViewId))
        .build().toByteArray());
    LayoutInspectorComposeProtocol.GetAllParametersResponse parameters =
        parameterResponses.poll(RESPONSE_WAIT_MS, TimeUnit.MILLISECONDS);
    if (parameters != null) {
      indexParameters(parameters);
    } else {
      warnings.add("compose parameters did not arrive; text labels are unavailable");
    }

    if (disposeInspectors) {
      try {
        disposeComposeInspector();
        disposeViewInspector();
      } catch (Throwable t) {
        warnings.add("dispose failed: " + t);
      }
    }

    printUtf8(toJson(response));
  }

  private void attachAgent() {
    Commands.Command attach = Commands.Command.newBuilder()
        .setType(Commands.Command.CommandType.ATTACH_AGENT)
        .setStreamId(streamId)
        .setPid(pid)
        .setCommandId(100)
        .setAttachAgent(Commands.AttachAgent.newBuilder()
            .setAgentLibFileName(agentLib)
            .setAgentConfigPath(agentConfig)
            .setPackageName(packageName)
            .setAttachTimeoutMs(15_000))
        .build();
    stub.execute(Transport.ExecuteRequest.newBuilder().setCommand(attach).build());
    log("attach-agent sent");
    sleep(1200);
  }

  private void createViewInspector() {
    createInspector("layoutinspector.view.inspection", viewDex, 1);
    sleep(1500);
  }

  private void createComposeInspector() {
    createInspector("layoutinspector.compose.inspection", composeDex, 3);
  }

  private void createInspector(String inspectorId, String dexPath, int commandId) {
    AppInspection.AppInspectionCommand command = AppInspection.AppInspectionCommand.newBuilder()
        .setInspectorId(inspectorId)
        .setCommandId(commandId)
        .setCreateInspectorCommand(AppInspection.CreateInspectorCommand.newBuilder()
            .setDexPath(dexPath)
            .setLaunchMetadata(AppInspection.LaunchMetadata.newBuilder()
                .setLaunchedByName("android-layout")
                .setForce(true))
            .build())
        .build();
    executeAppInspection(command);
    log("create-inspector sent: " + inspectorId);
  }

  private void disposeInspector(String inspectorId, int commandId) {
    AppInspection.AppInspectionCommand command = AppInspection.AppInspectionCommand.newBuilder()
        .setInspectorId(inspectorId)
        .setCommandId(commandId)
        .setDisposeInspectorCommand(AppInspection.DisposeInspectorCommand.newBuilder())
        .build();
    executeAppInspection(command);
  }

  private void disposeViewInspector() {
    disposeInspector("layoutinspector.view.inspection", 22);
  }

  private void disposeComposeInspector() {
    disposeInspector("layoutinspector.compose.inspection", 5);
  }

  private void sendViewRaw(int commandId, byte[] payload) {
    sendRaw("layoutinspector.view.inspection", commandId, payload);
  }

  private void sendComposeRaw(int commandId, byte[] payload) {
    sendRaw("layoutinspector.compose.inspection", commandId, payload);
  }

  private void sendRaw(String inspectorId, int commandId, byte[] payload) {
    AppInspection.AppInspectionCommand command = AppInspection.AppInspectionCommand.newBuilder()
        .setInspectorId(inspectorId)
        .setCommandId(commandId)
        .setRawInspectorCommand(AppInspection.RawCommand.newBuilder()
            .setContent(com.android.tools.idea.protobuf.ByteString.copyFrom(payload)))
        .build();
    executeAppInspection(command);
  }

  private void executeAppInspection(AppInspection.AppInspectionCommand command) {
    Commands.Command outer = Commands.Command.newBuilder()
        .setType(Commands.Command.CommandType.APP_INSPECTION)
        .setStreamId(streamId)
        .setPid(pid)
        .setAppInspectionCommand(command)
        .build();
    stub.execute(Transport.ExecuteRequest.newBuilder().setCommand(outer).build());
  }

  private void startListener() {
    listener = new Thread(() -> {
      try {
        Iterator<Common.Event> events = stub.getEvents(Transport.GetEventsRequest.newBuilder().build());
        while (running && events.hasNext()) {
          Common.Event event = events.next();
          if (event.hasAppInspectionResponse()) {
            AppInspection.AppInspectionResponse response = event.getAppInspectionResponse();
            log("response cmd=" + response.getCommandId() + " status=" + response.getStatus()
                + (response.getErrorMessage().isEmpty() ? "" : " error=" + response.getErrorMessage()));
            if (response.hasRawResponse()) {
              AppInspection.RawResponse raw = response.getRawResponse();
              if (raw.getDataCase() == AppInspection.RawResponse.DataCase.CONTENT) {
                parseComposeResponse(response.getCommandId(), raw.getContent().toByteArray());
              } else if (raw.getDataCase() == AppInspection.RawResponse.DataCase.PAYLOAD_ID) {
                payloadCommandIds.put(raw.getPayloadId(), response.getCommandId());
              }
            }
          }
          if (event.hasAppInspectionEvent() && event.getAppInspectionEvent().hasRawEvent()) {
            AppInspection.RawEvent raw = event.getAppInspectionEvent().getRawEvent();
            if (raw.getDataCase() == AppInspection.RawEvent.DataCase.CONTENT) {
              parseViewEvent(raw.getContent().toByteArray());
            }
          }
          if (event.hasAppInspectionPayload()) {
            AppInspection.AppInspectionPayload payload = event.getAppInspectionPayload();
            ByteArrayOutputStream buffer = chunks.computeIfAbsent(event.getGroupId(), k -> new ByteArrayOutputStream());
            try {
              buffer.write(payload.getChunk().toByteArray());
            } catch (Exception ignored) {
            }
            if (event.getIsEnded()) {
              ByteArrayOutputStream complete = chunks.remove(event.getGroupId());
              Integer commandId = payloadCommandIds.remove(event.getGroupId());
              if (complete != null) {
                parseComposeResponse(commandId == null ? -1 : commandId, complete.toByteArray());
              }
            }
          }
        }
      } catch (Throwable t) {
        if (running) log("event listener stopped: " + t);
      }
    });
    listener.setDaemon(true);
    listener.start();
  }

  private void stopListener() {
    running = false;
    if (listener != null) listener.interrupt();
  }

  private void parseViewEvent(byte[] bytes) {
    try {
      LayoutInspectorViewProtocol.Event event = LayoutInspectorViewProtocol.Event.parseFrom(bytes);
      if (event.hasRootsEvent() && rootViewId < 0 && event.getRootsEvent().getIdsCount() > 0) {
        rootViewId = event.getRootsEvent().getIds(0);
      }
      if (event.hasLayoutEvent() && event.getLayoutEvent().hasRootView()
          && event.getLayoutEvent().getRootView().hasNode() && rootViewId < 0) {
        rootViewId = event.getLayoutEvent().getRootView().getNode().getId();
      }
      if (event.hasErrorEvent()) {
        warnings.add("view inspector error: " + event.getErrorEvent().getMessage());
      }
    } catch (Throwable t) {
      warnings.add("view event parse failed: " + t);
    }
  }

  private void parseComposeResponse(int commandId, byte[] bytes) {
    if (commandId != -1 && commandId != composeCommandId && commandId != parameterCommandId) return;
    try {
      LayoutInspectorComposeProtocol.Response response =
          LayoutInspectorComposeProtocol.Response.parseFrom(bytes);
      if ((commandId == composeCommandId || commandId == -1) && response.hasGetComposablesResponse()) {
        composeResponses.offer(response.getGetComposablesResponse());
      } else if ((commandId == parameterCommandId || commandId == -1) && response.hasGetAllParametersResponse()) {
        parameterResponses.offer(response.getGetAllParametersResponse());
      }
    } catch (Throwable t) {
      warnings.add("compose response parse failed (" + commandId + "): " + t);
    }
  }

  private void indexParameters(LayoutInspectorComposeProtocol.GetAllParametersResponse response) {
    Map<Integer, String> strings = new HashMap<>();
    for (LayoutInspectorComposeProtocol.StringEntry entry : response.getStringsList()) {
      strings.put(entry.getId(), entry.getStr());
    }
    for (LayoutInspectorComposeProtocol.ParameterGroup group : response.getParameterGroupsList()) {
      Map<String, String> values = new HashMap<>();
      collectParameters(group.getParameterList(), strings, values);
      collectParameters(group.getMergedSemanticsList(), strings, values);
      collectParameters(group.getUnmergedSemanticsList(), strings, values);
      if (!values.isEmpty()) parametersByNode.put(group.getComposableId(), values);
    }
  }

  private void collectParameters(
      List<LayoutInspectorComposeProtocol.Parameter> parameters,
      Map<Integer, String> strings,
      Map<String, String> values) {
    for (LayoutInspectorComposeProtocol.Parameter parameter : parameters) {
      String name = strings.getOrDefault(parameter.getName(), "");
      if (name.isEmpty()) continue;
      if (parameter.getType() == LayoutInspectorComposeProtocol.Parameter.Type.STRING
          || parameter.getType() == LayoutInspectorComposeProtocol.Parameter.Type.ITERABLE) {
        String value = strings.get(parameter.getInt32Value());
        if (value != null) values.putIfAbsent(name, value);
      } else if (parameter.getType() == LayoutInspectorComposeProtocol.Parameter.Type.BOOLEAN) {
        values.putIfAbsent(name, parameter.getInt32Value() != 0 ? "true" : "false");
      } else if (parameter.getType() == LayoutInspectorComposeProtocol.Parameter.Type.INT32
          || parameter.getType() == LayoutInspectorComposeProtocol.Parameter.Type.INT64) {
        values.putIfAbsent(name, Integer.toString(parameter.getInt32Value()));
      }
    }
  }

  private String toJson(LayoutInspectorComposeProtocol.GetComposablesResponse response) {
    StringBuilder json = new StringBuilder(64 * 1024);
    json.append("{\"ok\":true");
    json.append(",\"rootViewId\":").append(rootViewId);
    json.append(",\"unchanged\":").append(response.getUnchanged());
    if (!warnings.isEmpty()) {
      json.append(",\"warnings\":[");
      for (int i = 0; i < warnings.size(); i++) {
        if (i > 0) json.append(',');
        quote(json, warnings.get(i));
      }
      json.append(']');
    }
    Map<Integer, String> strings = new HashMap<>();
    for (LayoutInspectorComposeProtocol.StringEntry entry : response.getStringsList()) {
      strings.put(entry.getId(), entry.getStr());
    }
    json.append(",\"roots\":[");
    for (int i = 0; i < response.getRootsCount(); i++) {
      if (i > 0) json.append(',');
      LayoutInspectorComposeProtocol.ComposableRoot root = response.getRoots(i);
      json.append("{\"viewId\":").append(root.getViewId()).append(",\"nodes\":[");
      for (int j = 0; j < root.getNodesCount(); j++) {
        if (j > 0) json.append(',');
        appendNode(json, root.getNodes(j), strings, 0);
      }
      json.append("]}");
    }
    json.append("]}\n");
    return json.toString();
  }

  private void appendNode(
      StringBuilder json,
      LayoutInspectorComposeProtocol.ComposableNode node,
      Map<Integer, String> strings,
      int depth) {
    json.append('{');
    json.append("\"id\":");
    quote(json, Long.toString(node.getId()));
    json.append(",\"name\":");
    quote(json, strings.getOrDefault(node.getName(), ""));
    json.append(",\"fileName\":");
    quote(json, strings.getOrDefault(node.getFilename(), ""));
    json.append(",\"lineNumber\":").append(node.getLineNumber());
    json.append(",\"offset\":").append(node.getOffset());
    json.append(",\"anchorHash\":").append(node.getAnchorHash());
    Map<String, String> params = parametersByNode.get(node.getId());
    if (params != null) {
      String text = params.get("text");
      String description = params.get("contentDescription");
      if (text != null) { json.append(",\"text\":"); quote(json, text); }
      if (description != null) { json.append(",\"contentDescription\":"); quote(json, description); }
    }
    json.append(",\"recomposeCount\":").append(node.getRecomposeCount());
    json.append(",\"recomposeSkips\":").append(node.getRecomposeSkips());
    json.append(",\"flags\":[");
    int flags = node.getFlags();
    boolean firstFlag = true;
    for (LayoutInspectorComposeProtocol.ComposableNode.Flags flag
        : LayoutInspectorComposeProtocol.ComposableNode.Flags.values()) {
      if ("UNRECOGNIZED".equals(flag.name())) continue;
      if (flag.getNumber() != 0 && (flags & flag.getNumber()) != 0) {
        if (!firstFlag) json.append(',');
        quote(json, flag.name());
        firstFlag = false;
      }
    }
    json.append(']');
    LayoutInspectorComposeProtocol.Bounds bounds = node.getBounds();
    if (bounds.hasLayout()) {
      LayoutInspectorComposeProtocol.Rect rect = bounds.getLayout();
      json.append(",\"bounds\":{\"left\":").append(rect.getX())
          .append(",\"top\":").append(rect.getY())
          .append(",\"width\":").append(rect.getW())
          .append(",\"height\":").append(rect.getH())
          .append('}');
    }
    if (bounds.hasRender()) {
      LayoutInspectorComposeProtocol.Quad quad = bounds.getRender();
      json.append(",\"renderQuad\":[")
          .append(quad.getX0()).append(',').append(quad.getY0()).append(',')
          .append(quad.getX1()).append(',').append(quad.getY1()).append(',')
          .append(quad.getX2()).append(',').append(quad.getY2()).append(',')
          .append(quad.getX3()).append(',').append(quad.getY3()).append(']');
    }
    json.append(",\"depth\":").append(depth);
    json.append(",\"children\":[");
    for (int i = 0; i < node.getChildrenCount(); i++) {
      if (i > 0) json.append(',');
      appendNode(json, node.getChildren(i), strings, depth + 1);
    }
    json.append("]}");
  }

  private static void quote(StringBuilder json, String value) {
    json.append('"');
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      switch (c) {
        case '"': json.append("\\\""); break;
        case '\\': json.append("\\\\"); break;
        case '\n': json.append("\\n"); break;
        case '\r': json.append("\\r"); break;
        case '\t': json.append("\\t"); break;
        default:
          if (c < 0x20) json.append(String.format("\\u%04x", (int) c));
          else json.append(c);
      }
    }
    json.append('"');
  }

  private static Map<String, String> parseArgs(String[] args) {
    Map<String, String> parsed = new HashMap<>();
    for (int i = 0; i < args.length; i++) {
      if (args[i].startsWith("--") && i + 1 < args.length) {
        parsed.put(args[i], args[++i]);
      }
    }
    return parsed;
  }

  private static void fail(String message) {
    StringBuilder json = new StringBuilder();
    json.append("{\"ok\":false,\"error\":");
    quote(json, message == null ? "unknown error" : message);
    json.append("}\n");
    printUtf8(json.toString());
    System.exit(2);
  }

  private static void log(String message) {
    System.err.println("[compose-helper] " + message);
  }

  private static void printUtf8(String text) {
    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
    System.out.write(bytes, 0, bytes.length);
    System.out.flush();
  }

  private static void sleep(long millis) {
    try { Thread.sleep(millis); } catch (InterruptedException ignored) {}
  }
}

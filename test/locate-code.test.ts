import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/locate-code.mjs", import.meta.url));

interface Candidate {
  file: string;
  line: number;
  kind: string;
  score: number;
}

interface LocatorResult {
  anchors: {
    strings: Array<{ name: string; value: string; file: string }>;
    ids: string[];
    compose: Array<{ name: string; file: string; line: number }>;
  };
  candidates: Candidate[];
}

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "dli-locate-"));
  const res = join(root, "app/src/main/res");
  const src = join(root, "app/src/main/java/demo/profile");
  await mkdir(join(res, "values"), { recursive: true });
  await mkdir(join(res, "values-zh"), { recursive: true });
  await mkdir(join(res, "layout"), { recursive: true });
  await mkdir(src, { recursive: true });

  await writeFile(
    join(res, "values/strings.xml"),
    `<resources>
  <string name="profile_title">我的</string>
</resources>
`,
    "utf8",
  );
  await writeFile(
    join(res, "values-zh/strings.xml"),
    `<resources>
  <string name="profile_title">我的</string>
</resources>
`,
    "utf8",
  );
  await writeFile(
    join(res, "layout/fragment_profile.xml"),
    `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">
  <TextView android:id="@+id/profile_entry" android:text="@string/profile_title" />
</LinearLayout>
`,
    "utf8",
  );
  await writeFile(
    join(res, "layout/activity_profile.xml"),
    `<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android">
  <include layout="@layout/fragment_profile" />
</FrameLayout>
`,
    "utf8",
  );
  await writeFile(
    join(src, "ProfileFragment.kt"),
    `package demo.profile

class ProfileFragment {
  fun onCreateView() {
    val binding = FragmentProfileBinding.inflate(inflater)
    binding.profileEntry.setOnClickListener { openProfile() }
    setContentView(R.layout.activity_profile)
  }
  fun title() = R.string.profile_title
}
`,
    "utf8",
  );
  await writeFile(
    join(src, "ProfileScreen.kt"),
    `package demo.profile

@Composable
fun ProfileScreen() {
  Text(text = stringResource(R.string.profile_title))
}

@Composable
fun Host() {
  ProfileScreen()
}
`,
    "utf8",
  );
  return root;
}

test("locate-code ranks Compose, XML and string anchors", async () => {
  const root = await fixtureRepo();
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "--root",
      root,
      "--text",
      "我的",
      "--id",
      "com.example:id/profile_entry",
      "--compose-name",
      "ProfileScreen",
      "--json",
    ]);
    const result = JSON.parse(stdout) as LocatorResult;
    assert.equal(result.anchors.ids[0], "profile_entry");
    assert.ok(result.anchors.strings.some((item) => item.name === "profile_title"));
    assert.ok(result.anchors.strings.some((item) => item.file.includes("values-zh")));
    assert.equal(result.anchors.compose[0].name, "ProfileScreen");
    assert.equal(result.anchors.compose[0].line, 4);

    const kinds = result.candidates.map((item) => item.kind);
    for (const kind of [
      "compose-definition",
      "string-usage-compose",
      "layout-id",
      "binding-usage",
      "layout-include-chain",
      "layout-inflation",
    ]) {
      assert.ok(kinds.includes(kind), `expected a ${kind} candidate, got ${kinds.join(", ")}`);
    }
    const compose = result.candidates.find((item) => item.kind === "compose-definition");
    assert.equal(compose?.score, 100);
    assert.ok(compose?.file.endsWith("ProfileScreen.kt"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("locate-code resolves a Compose line to the enclosing definition", async () => {
  const root = await fixtureRepo();
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "--root",
      root,
      "--compose-file",
      "ProfileScreen.kt",
      "--compose-line",
      "5",
      "--json",
    ]);
    const result = JSON.parse(stdout) as LocatorResult;
    assert.equal(result.anchors.compose.length, 1);
    assert.equal(result.anchors.compose[0].name, "ProfileScreen");
    const candidates = result.candidates.map((item) => item.kind);
    assert.ok(candidates.includes("compose-callsite"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("locate-code reports a clear miss without fabricating anchors", async () => {
  const root = await fixtureRepo();
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "--root",
      root,
      "--text",
      "服务端下发文案",
      "--json",
    ]);
    const result = JSON.parse(stdout) as LocatorResult;
    assert.equal(result.anchors.strings.length, 0);
    assert.equal(result.candidates.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

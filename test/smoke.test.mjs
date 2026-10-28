import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

async function loadClient() {
	const source = await readFile(path.join(root, "lib", "client.js"), "utf8");
	let loaded;
	globalThis.window = {
		__ModuleLoader__: {
			load(entry) {
				loaded = entry;
			}
		}
	};
	const script = new Function("window", source);
	script(globalThis.window);
	assert.ok(loaded, "client bundle calls window.__ModuleLoader__.load");
	const module = loaded.factory((id) => {
		assert.equal(id, "react", "the client bundle only imports the platform React module");
		return {
			createElement() {
				return {};
			}
		};
	});
	return { entry: loaded, module };
}

function makeHarness({
	candidates,
	summaries = {},
	cwd = "E:\\project\\alpha",
	workspaces = { items: [], archivedSessionIds: [], pinnedSessionIds: [] }
}) {
	const sources = [];
	const effects = [];
	const registrations = [];
	let opened;
	let launcher = null;
	const launcherListeners = new Set();
	const launcherStore = {
		getSnapshot() {
			return launcher;
		},
		subscribe(listener) {
			launcherListeners.add(listener);
			return () => launcherListeners.delete(listener);
		}
	};
	const setLauncher = (next) => {
		launcher = next;
		for (const listener of [...launcherListeners]) listener();
	};
	const sessions = {
		list: {
			getSnapshot() {
				return { byId: summaries };
			}
		},
		binding(sessionId) {
			assert.equal(sessionId, "session-self");
			return { ctx: { session: "scope" } };
		}
	};
	const workspacesService = {
		list: {
			getSnapshot() {
				return workspaces;
			}
		}
	};
	const remote = {
		sessionReferenceResolver: {
			async candidates(sessionId, query, signal) {
				assert.equal(sessionId, "session-self");
				assert.equal(query, "");
				assert.ok(signal instanceof AbortSignal);
				return candidates;
			}
		}
	};
	const inputTriggers = {
		registerSource(source) {
			sources.push(source);
			return () => {
				const at = sources.indexOf(source);
				if (at >= 0) sources.splice(at, 1);
			};
		},
		sessionOf(actx) {
			assert.deepEqual(actx, { session: "scope" });
			return {
				launcher: launcherStore,
				toggleSource(source, hit) {
					opened = { source, hit };
					setLauncher(source);
				}
			};
		}
	};
	const context = {
		effect(callback, label) {
			effects.push(label);
			const dispose = callback();
			return dispose;
		},
		get(name) {
			if (name === "sessions") return sessions;
			if (name === "inputTriggers") return inputTriggers;
			if (name === "workspaces") return workspacesService;
			if (name === "remote") return remote;
			return undefined;
		},
		remote,
		slots: {
			inject(key, callback) {
				assert.equal(key, "conversation.input.left");
				return callback();
			},
			register(definition, component) {
				registrations.push({ definition, component });
				return () => {};
			}
		}
	};
	return {
		context,
		sources,
		effects,
		registrations,
		open: () => opened,
		close: () => setLauncher(null),
		sessions,
		workspaces: workspacesService,
		inputTriggers
	};
}

function openPicker(harness, sessionId = "session-self") {
	const { definition } = harness.registrations[0];
	return definition.inject(sessionId).openWorkspaceSessionPicker({
		captureInsertion() {
			return { start: 0, end: 0, draftRev: 1 };
		}
	});
}

function mentionCandidate(overrides) {
	return {
		sessionId: "session-other",
		label: "Other",
		displayTitle: "Other",
		cwd: "E:\\project\\alpha",
		sameWorkspace: true,
		createdAt: 1_700_000_000_000,
		mention: "@[Other](dsh-session:c2Vzc2lvbi1vdGhlcg)",
		...overrides
	};
}

test("loads as a Web client module with the expected inject list", async () => {
	const { module } = await loadClient();
	assert.deepEqual(module.inject, [
		"inputTriggers",
		"sessions",
		"slots",
		"workspaces",
		"remote",
		"remote.sessionReferenceResolver"
	]);
	assert.equal(typeof module.apply, "function");
});

test("lists every Session in the current Workspace, newest first", async () => {
	const { module } = await loadClient();
	const harness = makeHarness({
		candidates: {
			ok: true,
			value: [
				mentionCandidate({
					sessionId: "session-old",
					displayTitle: "Older task",
					mention: "@[Older task](dsh-session:c2Vzc2lvbi1vdGhlcg)",
					updatedAt: 1_700_000_000_000
				}),
				mentionCandidate({
					sessionId: "session-other-project",
					displayTitle: "Other project",
					sameWorkspace: true,
					mention: "@[Other project](dsh-session:c2Vzc2lvbi1vdGhlcg)",
					cwd: "E:\\project\\alpha",
					updatedAt: 1_900_000_000_000
				}),
				mentionCandidate({
					sessionId: "session-new",
					displayTitle: "Newer task",
					sameWorkspace: false,
					mention: "@[Newer task](dsh-session:c2Vzc2lvbi1vdGhlcg)",
					cwd: "E:\\project\\alpha\\packages\\web",
					updatedAt: 1_800_000_000_000
				})
			]
		},
		summaries: {
			"session-self": { cwd: "E:\\project\\alpha", updatedAt: 1_700_000_000_000 },
			"session-old": { cwd: "E:\\project\\alpha", updatedAt: 1_700_000_000_000 },
			"session-new": { cwd: "E:\\project\\alpha\\packages\\web", updatedAt: 1_800_000_000_000 },
			"session-other-project": { cwd: "E:\\project\\alpha", updatedAt: 1_900_000_000_000 }
		},
		workspaces: {
			items: [
				{
					workspaceId: "workspace-alpha",
					title: "Alpha",
					path: "E:\\project\\alpha",
					sessionIds: ["session-self", "session-old", "session-new"]
				}
			],
			archivedSessionIds: [],
			pinnedSessionIds: []
		}
	});
	module.apply(harness.context);
	assert.equal(harness.sources.length, 1);
	assert.equal(harness.registrations.length, 1);

	const source = harness.sources[0];
	assert.equal(source.trigger, "@");
	assert.equal(source.name, "workspaceSessionLink");
	assert.equal(source.showGroupTitle, false);
	const controller = new AbortController();
	const outside = await source.candidates(
		{ sessionId: "session-self" },
		{ query: "", quoted: false, position: "inline", drilled: false, signal: controller.signal }
	);
	assert.deepEqual(outside, [], "a typed @ gets no rows from this source");
	openPicker(harness);

	const rows = await source.candidates(
		{ sessionId: "session-self" },
		{ query: "", quoted: false, position: "inline", drilled: false, signal: controller.signal }
	);
	assert.equal(rows.length, 2);
	assert.deepEqual(
		rows.map((row) => row.label),
		["Newer task", "Older task"]
	);
	assert.match(rows[0].section, /本工作区 · Alpha/u);
	assert.equal(rows[0].icon, "session");
	assert.ok(rows[0].description, "a recent-session age is rendered");

	const picked = source.onPick({ candidate: rows[0] });
	assert.deepEqual(picked, {
		insert: {
			source: "reference",
			ref: "@[Newer task](dsh-session:c2Vzc2lvbi1vdGhlcg)",
			label: "Newer task",
			appearance: "session",
			clipboardText: "@[Newer task](dsh-session:c2Vzc2lvbi1vdGhlcg)"
		}
	});
	await assert.doesNotReject(async () => source.codec.serialize(picked.insert.ref, new AbortController().signal));
	harness.close();
	const afterClose = await source.candidates(
		{ sessionId: "session-self" },
		{ query: "", quoted: false, position: "inline", drilled: false, signal: new AbortController().signal }
	);
	assert.deepEqual(afterClose, [], "closing the menu disarms the source again");
});

test("renders a non-clickable placeholder when the workspace has no other sessions", async () => {
	const { module } = await loadClient();
	const harness = makeHarness({
		candidates: { ok: true, value: [] },
		summaries: { "session-self": { cwd: "E:\\project\\alpha" } }
	});
	module.apply(harness.context);
	openPicker(harness);
	const rows = await harness.sources[0].candidates(
		{ sessionId: "session-self" },
		{ query: "", quoted: false, position: "inline", drilled: false, signal: new AbortController().signal }
	);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].label, "本工作区暂无其他会话");
	assert.equal(rows[0].value, JSON.stringify({ placeholder: true }));
	assert.equal(harness.sources[0].onPick({ candidate: rows[0] }), undefined);
});

test("falls back to cwd affinity when the current Session has no Workspace row", async () => {
	const { module } = await loadClient();
	const harness = makeHarness({
		candidates: {
			ok: true,
			value: [
				mentionCandidate({ sessionId: "session-same", displayTitle: "Same cwd", sameWorkspace: true }),
				mentionCandidate({
					sessionId: "session-other",
					displayTitle: "Other cwd",
					sameWorkspace: false,
					cwd: "E:\\project\\beta"
				})
			]
		},
		summaries: {
			"session-self": { cwd: "E:\\project\\alpha" },
			"session-same": { cwd: "E:\\project\\alpha" },
			"session-other": { cwd: "E:\\project\\beta" }
		}
	});
	module.apply(harness.context);
	openPicker(harness);
	const rows = await harness.sources[0].candidates(
		{ sessionId: "session-self" },
		{ query: "", quoted: false, position: "inline", drilled: false, signal: new AbortController().signal }
	);
	assert.deepEqual(
		rows.map((row) => row.label),
		["Same cwd"]
	);
	assert.match(rows[0].section, /本工作区 · alpha/u);
});

test("the composer button opens exactly the workspace session source at the captured selection", async () => {
	const { module } = await loadClient();
	const harness = makeHarness({
		candidates: { ok: true, value: [] },
		summaries: { "session-self": { cwd: "E:\\project\\alpha" } }
	});
	module.apply(harness.context);
	const { definition, component } = harness.registrations[0];
	assert.equal(definition.name, "conversation.input.left");
	assert.equal(definition.id, "dsh-workspace-session-link");
	const injection = definition.inject("session-self");
	assert.equal(typeof injection.openWorkspaceSessionPicker, "function");
	assert.equal(typeof component, "function");

	const span = { start: 4, end: 4, draftRev: 7 };
	injection.openWorkspaceSessionPicker({
		captureInsertion() {
			return span;
		}
	});
	assert.equal(harness.open().source, "workspaceSessionLink");
	assert.deepEqual(harness.open().hit, {
		trigger: "@",
		query: "",
		quoted: false,
		position: "inline",
		span
	});
});

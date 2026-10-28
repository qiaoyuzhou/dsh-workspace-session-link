window.__ModuleLoader__.load({
	id: "dsh-workspace-session-link",
	factory: (require) => {
		const React = require("react");
		const h = React.createElement;

		const PLUGIN = "dsh-workspace-session-link";
		const SOURCE = "workspaceSessionLink";
		const TRIGGER = "@";
		const BUTTON_CLASS = "dsh-wsl-button";

		const CSS = [
			".dsh-wsl-button{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none;font-size:13px;font-weight:500;line-height:20px;transition:background-color .1s ease,color .1s ease}",
			".dsh-wsl-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".dsh-wsl-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}",
			".dsh-wsl-button:disabled{opacity:.4;cursor:default}",
			".dsh-wsl-button svg{display:block;pointer-events:none;flex:none}",
			".dsh-wsl-label{white-space:nowrap}",
			"@container (width<=560px){.dsh-wsl-button{width:28px;padding:0;border-radius:999px}.dsh-wsl-label{display:none}}"
		].join("");

		/** Use the final path segment as the menu's workspace label. */
		function workspaceName(cwd) {
			if (typeof cwd !== "string" || cwd.trim() === "") return "";
			const parts = cwd.replace(/[\\/]+$/u, "").split(/[\\/]/u).filter(Boolean);
			return parts.at(-1) ?? "";
		}

		/** Compact Chinese relative time for a session row, without adding a locale dependency. */
		function relativeTime(value, now) {
			const at = typeof value === "number" ? value : Number(value);
			if (!Number.isFinite(at) || at <= 0) return "";
			const diff = Math.max(0, now - at);
			if (diff < 60_000) return "刚刚";
			if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
			if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
			if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
			try {
				return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(at);
			} catch {
				return new Date(at).toLocaleDateString();
			}
		}

		/** Parse the source-owned candidate payload; malformed rows do nothing. */
		function parseValue(value) {
			if (typeof value !== "string" || value === "") return undefined;
			try {
				return JSON.parse(value);
			} catch {
				return undefined;
			}
		}

		function placeholder(section, name, description) {
			return {
				name,
				label: name,
				description,
				icon: "session",
				section,
				value: JSON.stringify({ placeholder: true })
			};
		}

		/**
		 * Render the composer button. `openWorkspaceSessionPicker` comes from the
		 * slot's inject closure and owns resolving the current session scope.
		 */
		function LinkButton({ inputActions, openWorkspaceSessionPicker, useInput }) {
			const phase = useInput((state) => state.phase);
			const disabled = phase !== "plain";
			return h(
				"button",
				{
					type: "button",
					className: BUTTON_CLASS,
					"aria-label": "链接本工作区会话",
					title: "链接本工作区会话",
					disabled,
					onMouseDown: (event) => {
						// Keep the composer's caret and selection while the picker opens.
						event.preventDefault();
					},
					onClick: () => {
						if (inputActions !== undefined) openWorkspaceSessionPicker(inputActions);
					}
				},
				h(
					"svg",
					{
						width: 16,
						height: 16,
						viewBox: "0 0 16 16",
						fill: "none",
						"aria-hidden": "true",
						focusable: "false"
					},
					h("path", {
						d: "M6.35 9.65a2.9 2.9 0 0 0 4.1 0l1.8-1.8a2.9 2.9 0 1 0-4.1-4.1L7.1 4.8",
						stroke: "currentColor",
						strokeWidth: 1.3,
						strokeLinecap: "round",
						strokeLinejoin: "round"
					}),
					h("path", {
						d: "M9.65 6.35a2.9 2.9 0 0 0-4.1 0l-1.8 1.8a2.9 2.9 0 1 0 4.1 4.1l1.05-1.05",
						stroke: "currentColor",
						strokeWidth: 1.3,
						strokeLinecap: "round",
						strokeLinejoin: "round"
					})
				),
				h("span", { className: "dsh-wsl-label" }, "链接会话")
			);
		}

		/** Required client services. The trigger pipeline and Session catalog are the actual seams. */
		const inject = [
			"inputTriggers",
			"sessions",
			"slots",
			"workspaces",
			"remote",
			"remote.sessionReferenceResolver"
		];

		function apply(ctx) {
			const sessions = ctx.get("sessions");
			const inputTriggers = ctx.get("inputTriggers");
			const workspaces = ctx.get("workspaces");
			const remote = ctx.remote ?? ctx.get("remote");

			ctx.effect(() => {
				if (typeof document === "undefined") return;
				for (const stale of document.querySelectorAll(`style[data-plugin="${PLUGIN}"]`)) stale.remove();
				const style = document.createElement("style");
				style.dataset.plugin = PLUGIN;
				style.textContent = CSS;
				document.head.appendChild(style);
				return () => style.remove();
			}, `${PLUGIN}: styles`);

			/** The button arms one session's candidate list; ordinary `@` menus stay untouched. */
			const activePicker = { sessionId: undefined, unsubscribe: undefined };
			const clearActivePicker = () => {
				const unsubscribe = activePicker.unsubscribe;
				activePicker.sessionId = undefined;
				activePicker.unsubscribe = undefined;
				unsubscribe?.();
			};
			ctx.effect(() => clearActivePicker, `${PLUGIN}: composer picker lifetime`);

			/**
			 * Candidate source for the current Workspace. It returns canonical
			 * mention payloads; the trigger pipeline turns a pick into a real
			 * composer chip through the scoped insert-reference event.
			 */
			const source = {
				trigger: TRIGGER,
				name: SOURCE,
				order: 0,
				showGroupTitle: false,
				async candidates(session, request) {
					// This source is always registered so the trigger pipeline can open
					// it from the button, but it contributes nothing to a typed `@`.
					if (activePicker.sessionId !== session.sessionId) return [];
					const currentCwd = sessions.list.getSnapshot().byId[session.sessionId]?.cwd;
					const workspaceState = workspaces?.list.getSnapshot();
					const workspace = workspaceState?.items.find((item) =>
						item.sessionIds.includes(session.sessionId)
					);
					// Prefer Workspace membership: a Session whose cwd is a workspace
					// subdirectory still belongs to that Workspace. Older or blank
					// sessions without a Workspace row fall back to exact cwd affinity.
					const members = workspace === undefined ? undefined : new Set(workspace.sessionIds);
					const workspaceLabel =
						workspace?.title ??
						(workspaceName(workspace?.path) || workspaceName(currentCwd));
					const section =
						workspaceLabel === "" ? "本工作区会话" : `本工作区 · ${workspaceLabel}`;
					if (remote === undefined) {
						return [placeholder(section, "无法读取本工作区会话", "当前客户端没有可用的会话引用服务")];
					}
					let result;
					try {
						result = await remote.sessionReferenceResolver.candidates(session.sessionId, request.query, request.signal);
					} catch (error) {
						if (request.signal.aborted) return [];
						console.error(`[${PLUGIN}] session candidate discovery failed:`, error);
						return [placeholder(section, "读取本工作区会话失败", "请稍后重试")];
					}
					if (request.signal.aborted) return [];
					if (!result.ok) {
						console.error(`[${PLUGIN}] session candidate discovery failed:`, result.error);
						return [placeholder(section, "读取本工作区会话失败", "请稍后重试")];
					}
					const listed = sessions.list.getSnapshot().byId;
					const now = Date.now();
					const rows = result.value
						.filter(
							(candidate) =>
								candidate.sessionId !== session.sessionId &&
								(members === undefined
									? candidate.sameWorkspace === true
									: members.has(candidate.sessionId))
						)
						.map((candidate) => {
							const summary = listed[candidate.sessionId];
							const title = candidate.displayTitle ?? candidate.label ?? candidate.sessionId;
							return {
								candidate,
								title,
								at: summary?.updatedAt ?? candidate.createdAt
							};
						})
						.sort((left, right) => (Number(right.at) || 0) - (Number(left.at) || 0))
						.map(({ candidate, title, at }) => ({
							name: title,
							label: title,
							description: relativeTime(at, now) || undefined,
							icon: "session",
							section,
							value: JSON.stringify({ mention: candidate.mention, label: title })
						}));
					if (rows.length === 0) {
						return [placeholder(section, "本工作区暂无其他会话", "先在这个工作区打开或新建另一个会话")];
					}
					return rows;
				},
				onPick({ candidate }) {
					const value = parseValue(candidate.value);
					if (value === undefined || typeof value.mention !== "string" || value.mention === "") return undefined;
					const label = typeof value.label === "string" && value.label !== "" ? value.label : "会话";
					return {
						insert: {
							source: "reference",
							ref: value.mention,
							label,
							appearance: "session",
							clipboardText: value.mention
						}
					};
				},
				codec: {
					clipboardText: (ref) => ref,
					serialize: (ref) => Promise.resolve(ref)
				}
			};

			ctx.effect(() => inputTriggers.registerSource(source), `${PLUGIN}: workspace session source`);

			/**
			 * Resolve the retained session scope and open the picker above the
			 * composer. The trigger menu owns keyboard navigation, click-away
			 * dismissal, and the atomic insert.
			 */
			const openWorkspaceSessionPicker = (sessionId, inputActions) => {
				try {
					const binding = sessions.binding(sessionId);
					if (binding === undefined) throw new Error(`session "${sessionId}" has no retained binding`);
					const controller = inputTriggers.sessionOf(binding.ctx);
					const hit = {
						trigger: TRIGGER,
						query: "",
						quoted: false,
						position: "inline",
						span: inputActions.captureInsertion()
					};
					if (controller.launcher.getSnapshot() === SOURCE) {
						// Clicking the button again closes the picker it opened.
						controller.toggleSource(SOURCE, hit);
						return;
					}
					clearActivePicker();
					activePicker.sessionId = sessionId;
					const unsubscribe = controller.launcher.subscribe(() => {
						if (controller.launcher.getSnapshot() !== null) return;
						if (activePicker.sessionId !== sessionId) return;
						clearActivePicker();
					});
					activePicker.unsubscribe = unsubscribe;
					controller.toggleSource(SOURCE, hit);
					if (controller.launcher.getSnapshot() !== SOURCE) clearActivePicker();
				} catch (error) {
					clearActivePicker();
					console.error(`[${PLUGIN}] failed to open the workspace session picker:`, error);
				}
			};

			ctx.effect(
				() =>
					ctx.slots.inject("conversation.input.left", () =>
						ctx.slots.register(
							{
								name: "conversation.input.left",
								id: PLUGIN,
								order: 50,
								inject: (sessionId) => ({
									openWorkspaceSessionPicker: (inputActions) =>
										openWorkspaceSessionPicker(sessionId, inputActions)
								})
							},
							LinkButton
						)
					),
				`${PLUGIN}: composer button`
			);
		}

		return { apply, inject };
	}
});

import { isValidElement, type ReactNode } from "react";

type ReactElementWithChildren = {
	className?: string;
	children?: ReactNode;
};

export function getPlainText(children: ReactNode): string {
	if (typeof children === "string" || typeof children === "number") {
		return String(children);
	}
	if (Array.isArray(children)) {
		return children.map(getPlainText).join("");
	}
	if (isValidElement<ReactElementWithChildren>(children)) {
		return getPlainText(children.props.children);
	}
	return "";
}

export function getMermaidSource(children: ReactNode): string | null {
	const childArray = Array.isArray(children) ? children : [children];

	for (const child of childArray) {
		if (!isValidElement<ReactElementWithChildren>(child)) continue;
		const className = child.props.className ?? "";
		if (/\blanguage-mermaid\b/.test(className)) {
			return getPlainText(child.props.children).replace(/\n$/, "");
		}
	}

	return null;
}

export function hasOpenMermaidFence(content: string): boolean {
	let openFence: {
		marker: "`" | "~";
		length: number;
		isMermaid: boolean;
	} | null = null;

	for (const line of content.split(/\r?\n/)) {
		if (openFence) {
			const closeMatch = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
			if (
				closeMatch &&
				closeMatch[1][0] === openFence.marker &&
				closeMatch[1].length >= openFence.length
			) {
				openFence = null;
			}
			continue;
		}

		const openMatch = line.match(/^ {0,3}(`{3,}|~{3,})([^`]*)$/);
		if (!openMatch) continue;

		const marker = openMatch[1][0] as "`" | "~";
		const info = openMatch[2].trim().toLowerCase();
		openFence = {
			marker,
			length: openMatch[1].length,
			isMermaid: /^mermaid(?:\s|$)/.test(info),
		};
	}

	return openFence?.isMermaid ?? false;
}

export function sanitizeMermaidSource(source: string): string {
	// Strip %%{init...}%% or %%{initialize...}%% directives to prevent config injection
	return source.replace(/%%\{[\s\S]*?\}%%/g, (match) => {
		if (/init|initialize/i.test(match)) {
			return "";
		}
		return match;
	});
}

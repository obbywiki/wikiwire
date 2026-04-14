export type mapped_shared = {
  is_shared: true;
  title: string;
  content_model: string;
  kind: 'module' | 'template';
};

export type mapped_site = {
  is_shared: false;
  title: string;
  content_model: string;
  kind: 'module' | 'template';
};

export type mapped_path = mapped_shared | mapped_site;

export function map_repo_path(
  relative_path: string,
  options: { css_content_model?: string } = {},
): mapped_path | null {
  const css_content_model = options.css_content_model ?? 'sanitized-css';
  const normalized = relative_path.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  const root = parts[0];
  if (root !== 'modules' && root !== 'templates') return null;

  if (parts.length < 4) {
    throw new Error(
      `WikiWire: path too shallow (need ${root}/<path_segment>/<root_name>/<file>): ${relative_path}`,
    );
  }

  const path_segment = parts[1];
  const is_shared = path_segment === 'shared';
  const root_name = parts[2];
  const rest = parts.slice(3);
  const rel_under_root = rest.join('/');

  if (root === 'modules') {
    if (rel_under_root.endsWith('.template.wikitext')) {
      throw new Error(
        `WikiWire: ${relative_path}: .template.wikitext belongs under templates/, not modules/`,
      );
    }

    if (rel_under_root === `${root_name}.module.lua`) {
      return {
        is_shared,
        title: `Module:${root_name}`,
        content_model: 'scribunto',
        kind: 'module',
      };
    }
    if (rel_under_root === `${root_name}.module.luau`) {
      return {
        is_shared,
        title: `Module:${root_name}`,
        content_model: 'scribunto',
        kind: 'module',
      };
    }
    if (rel_under_root === 'doc.wikitext') {
      return {
        is_shared,
        title: `Module:${root_name}/doc`,
        content_model: 'wikitext',
        kind: 'module',
      };
    }

    const content_model = content_model_for_repo_subfile(rel_under_root, css_content_model, {
      allow_scribunto: true,
    });
    return {
      is_shared,
      title: `Module:${root_name}/${rel_under_root}`,
      content_model,
      kind: 'module',
    };
  }

  if (rel_under_root === `${root_name}.template.wikitext`) {
    return {
      is_shared,
      title: `Template:${root_name}`,
      content_model: 'wikitext',
      kind: 'template',
    };
  }
  if (rel_under_root === 'doc.wikitext') {
    return {
      is_shared,
      title: `Template:${root_name}/doc`,
      content_model: 'wikitext',
      kind: 'template',
    };
  }

  const content_model = content_model_for_repo_subfile(rel_under_root, css_content_model, {
    allow_scribunto: false,
  });
  return {
    is_shared,
    title: `Template:${root_name}/${rel_under_root}`,
    content_model,
    kind: 'template',
  };
}

export function content_model_for_repo_subfile(
  rel_under_root: string,
  css_content_model: string,
  opts: { allow_scribunto: boolean },
): string {
  if (opts.allow_scribunto) {
    if (rel_under_root.endsWith('.module.lua')) return 'scribunto';
    if (rel_under_root.endsWith('.module.luau')) return 'scribunto';
  } else {
    if (rel_under_root.endsWith('.module.lua') || rel_under_root.endsWith('.module.luau')) {
      throw new Error(
        `WikiWire: ${rel_under_root}: Scribunto module files belong under modules/, not templates/`,
      );
    }
  }

  if (rel_under_root.endsWith('.wikitext')) return 'wikitext';
  if (rel_under_root.endsWith('.css')) return css_content_model;
  if (rel_under_root.endsWith('.json')) return 'json';

  throw new Error(
    `WikiWire: unsupported subfile extension: ${rel_under_root} (allowed: .module.lua, .module.luau, .wikitext, .css, .json; .module.lua/.module.luau only under modules/)`,
  );
}

export function content_model_for_module_subfile(
  rel_under_root: string,
  css_content_model: string,
): string {
  return content_model_for_repo_subfile(rel_under_root, css_content_model, {
    allow_scribunto: true,
  });
}

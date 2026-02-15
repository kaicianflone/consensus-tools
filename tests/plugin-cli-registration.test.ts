import test from 'node:test';
import assert from 'node:assert/strict';

import register from '../index';

function createCommand(name: string) {
  return {
    _name: name,
    commands: [] as any[],
    name() {
      return this._name;
    },
    description() {
      return this;
    },
    option() {
      return this;
    },
    requiredOption() {
      return this;
    },
    action() {
      return this;
    },
    command(spec: string) {
      const childName = String(spec).trim().split(/\s+/)[0] || spec;
      const child = createCommand(childName);
      this.commands.push(child);
      return child;
    }
  };
}

test('plugin registers consensus CLI command synchronously', () => {
  const program = createCommand('openclaw');

  let registerCliMeta: any = null;

  const api = {
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
      child() {
        return this;
      }
    },
    config: {
      getPluginConfig() {
        return undefined;
      }
    },
    registerCli(fn: any, meta: any) {
      registerCliMeta = meta;
      fn({ program });
    },
    registerTool() {},
    registerService() {}
  };

  const result = register(api as any);

  assert.equal(result, undefined);
  assert.deepEqual(registerCliMeta?.commands, ['consensus']);
  assert.ok(program.commands.some((cmd) => cmd.name() === 'consensus'));
});

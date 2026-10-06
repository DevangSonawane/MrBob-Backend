const spec = require('../src/docs');
const { mounts } = require('../src/routes');

// Every route the app serves, as "METHOD /path/{param}".
const servedOperations = () =>
  mounts.flatMap(([mountPath, router]) =>
    router.stack
      .filter((layer) => layer.route)
      .flatMap((layer) => {
        const path = `${mountPath}${layer.route.path === '/' ? '' : layer.route.path}`.replace(/:(\w+)/g, '{$1}');
        return Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${path}`);
      }),
  );

const documentedOperations = () =>
  Object.entries(spec.paths).flatMap(([path, methods]) => Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`));

describe('API documentation', () => {
  it('documents every route, and nothing that does not exist', () => {
    expect(documentedOperations().sort()).toEqual(servedOperations().sort());
  });

  it('gives every operation a summary, an access note, a success response and a known tag', () => {
    const tagNames = spec.tags.map((tag) => tag.name);
    Object.entries(spec.paths).forEach(([path, methods]) => {
      Object.entries(methods).forEach(([method, operation]) => {
        const label = `${method.toUpperCase()} ${path}`;
        expect(`${label}: ${operation.summary ?? ''}`).not.toBe(`${label}: `);
        expect(`${label}: ${operation.description}`).toContain('**Access:**');
        expect(tagNames).toEqual(expect.arrayContaining(operation.tags));
        expect(Object.keys(operation.responses).some((code) => code.startsWith('2'))).toBe(true);
      });
    });
  });

  it('documents a request body for every write that takes one', () => {
    const bodyless = [
      'POST /vendor-onboarding/submit',
      'POST /vendor-onboarding/applications/{id}/documents/{type}/verify',
      'POST /vendor-onboarding/applications/{id}/approve',
      'POST /payments/bookings/{bookingId}/order',
      'POST /amc/{id}/cancel',
    ];
    Object.entries(spec.paths).forEach(([path, methods]) => {
      Object.entries(methods).forEach(([method, operation]) => {
        const label = `${method.toUpperCase()} ${path}`;
        if (['get', 'delete'].includes(method) || bodyless.includes(label)) return;
        expect(`${label}: ${Boolean(operation.requestBody)}`).toBe(`${label}: true`);
      });
    });
  });

  it('only references schemas and responses that are defined', () => {
    const refs = JSON.stringify(spec).match(/#\/components\/(schemas|responses)\/\w+/g);
    [...new Set(refs)].forEach((pointer) => {
      const [, , kind, name] = pointer.split('/');
      expect(`${pointer}: ${Boolean(spec.components[kind][name])}`).toBe(`${pointer}: true`);
    });
  });

  it('lists the vendor onboarding steps first and in order', () => {
    expect(spec.tags.slice(0, 5).map((tag) => tag.name)).toEqual([
      'Vendor onboarding · Step 1 – Phone number',
      'Vendor onboarding · Step 2 – Verify OTP',
      'Vendor onboarding · Step 3 – Enter details',
      'Vendor onboarding · Step 4 – Verify vendor (admin)',
      'Vendor onboarding · Step 5 – Vendor verified',
    ]);
  });
});

import { normalizeFillPolicyForMobile } from '../src/storage/fill-policy-mobile';
import {
  defaultDirRuleForm,
  dirRuleToForm,
  emptyDirRuleForm,
} from '../src/services/workplace-operations.service';

describe('normalizeFillPolicyForMobile', () => {
  it('maps full to hidden', () => {
    expect(normalizeFillPolicyForMobile('full')).toBe('hidden');
  });

  it('passes through filename, header, hidden', () => {
    expect(normalizeFillPolicyForMobile('filename')).toBe('filename');
    expect(normalizeFillPolicyForMobile('header')).toBe('header');
    expect(normalizeFillPolicyForMobile('hidden')).toBe('hidden');
  });
});

describe('dirRuleToForm', () => {
  it('maps historical full fill to hidden in form', () => {
    const form = dirRuleToForm({
      logicalPath: '/docs',
      sortField: 'name',
      sortOrder: 'asc',
      headCount: 1,
      tailCount: 0,
      fillPolicy: 'full',
      ruleEnabled: true,
    });
    expect(form.fillPolicy).toBe('hidden');
  });
});

describe('defaultDirRuleForm', () => {
  it('uses Core default header fill', () => {
    expect(defaultDirRuleForm('/docs').fillPolicy).toBe('header');
    expect(defaultDirRuleForm('/docs').ruleEnabled).toBe(true);
  });
});

describe('emptyDirRuleForm', () => {
  it('无持久化规则时 ruleEnabled 为 false', () => {
    expect(emptyDirRuleForm('/docs').ruleEnabled).toBe(false);
  });
});

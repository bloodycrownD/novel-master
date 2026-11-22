import {FillPolicyMobile} from '@/services/fill-policy-mobile'
import {WorkplaceOperationsService} from '@/services/workplace-operations.service'

describe('normalizeFillPolicyForMobile', () => {
    it('maps full to hidden', () => {
        expect(FillPolicyMobile.normalize('full')).toBe('hidden');
    });

    it('passes through filename, header, hidden', () => {
        expect(FillPolicyMobile.normalize('filename')).toBe('filename');
        expect(FillPolicyMobile.normalize('header')).toBe('header');
        expect(FillPolicyMobile.normalize('hidden')).toBe('hidden');
    });
});

describe('dirRuleToForm', () => {
    it('maps historical full fill to hidden in form', () => {
        const form = WorkplaceOperationsService.dirRuleToForm({
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
        expect(WorkplaceOperationsService.defaultDirRuleForm('/docs').fillPolicy).toBe('header');
        expect(WorkplaceOperationsService.defaultDirRuleForm('/docs').ruleEnabled).toBe(true);
    });
});

describe('emptyDirRuleForm', () => {
    it('无持久化规则时 ruleEnabled 为 false', () => {
        expect(WorkplaceOperationsService.emptyDirRuleForm('/docs').ruleEnabled).toBe(false);
    });
});

import { applyDraftDecision } from './approval';

function mailer() {
  return { sendDraft: jest.fn(async () => undefined), deleteDraft: jest.fn(async () => undefined) };
}

describe('applyDraftDecision', () => {
  it('sends the draft on approve and deletes it on deny', async () => {
    const approved = mailer();
    const sent = await applyDraftDecision(approved, {
      kind: 'email',
      status: 'approved',
      payload: { draftId: 'd1' },
    });
    expect(sent).toBe('sent');
    expect(approved.sendDraft).toHaveBeenCalledWith('d1');
    expect(approved.deleteDraft).not.toHaveBeenCalled();

    const denied = mailer();
    const deleted = await applyDraftDecision(denied, {
      kind: 'email',
      status: 'denied',
      payload: { draftId: 'd2' },
    });
    expect(deleted).toBe('deleted');
    expect(denied.deleteDraft).toHaveBeenCalledWith('d2');
    expect(denied.sendDraft).not.toHaveBeenCalled();
  });

  it('is inert for approvals without a draft and refuses to act without credentials', async () => {
    const api = mailer();
    expect(await applyDraftDecision(api, { kind: 'email', status: 'approved', payload: {} })).toBe(
      'none',
    );
    expect(
      await applyDraftDecision(api, {
        kind: 'message',
        status: 'approved',
        payload: { draftId: 'd1' },
      }),
    ).toBe('none');
    expect(api.sendDraft).not.toHaveBeenCalled();
    await expect(
      applyDraftDecision(null, { kind: 'email', status: 'approved', payload: { draftId: 'd1' } }),
    ).rejects.toThrow('no Gmail credentials');
  });
});

// Flow-panel UI for the promote-submission operation.
export default {
  id: 'promote-submission',
  name: 'Promote Submission to Content',
  icon: 'publish',
  description: 'Create a draft content_item from an approved submission, in one transaction.',
  overview: ({ submission_id }) => [
    { label: 'Submission', text: submission_id || '(bound at runtime)' },
  ],
  options: [
    {
      field: 'submission_id',
      name: 'Submission ID',
      type: 'string',
      meta: {
        width: 'full',
        interface: 'input',
        note: 'Bound by the Flow to {{$trigger.body.keys[0]}}. Leave as-is.',
      },
    },
  ],
};
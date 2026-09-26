import pytest
from fastapi import HTTPException
from network_dashboard.tables import read_table


def test_event_rows_preserve_missing_values_and_order(tmp_path):
    path = tmp_path / 'run_events.tsv'
    path.write_text('onset\tduration\ttrial_type\tresponse_time\n2\t1\tgo\tn/a\n1\t1\tgo\t.3\n')
    result = read_table(path)
    assert result['kind'] == 'events'
    assert result['rows'][0]['response_time'] == 'n/a'
    assert result['nonmonotonic_pairs'] == 1
    assert result['total_rows'] == 2


def test_matrix_preview_is_bounded_without_claiming_full_data(tmp_path):
    path = tmp_path / 'sub-s03_desc-designMatrix.csv'
    path.write_text('go,go_omission\n1,0\n2,0\n3,1\n')
    result = read_table(path, max_rows=2)
    assert result['kind'] == 'design'
    assert result['truncated'] and result['total_rows'] == 3
    assert len(result['rows']) == 2


def test_unrelated_tables_are_not_interpreted_as_designs(tmp_path):
    path = tmp_path / 'participants.tsv'
    path.write_text('a\n1\n')
    with pytest.raises(HTTPException): read_table(path)


def test_annex_target_uses_registered_name(tmp_path):
    path = tmp_path / 'SHA256E-s10--abc.csv'
    path.write_text('go,omission\n1,0\n')
    assert read_table(path, name='sub-s03_design_matrix.csv')['kind'] == 'design'


def test_behavior_metrics_cover_all_test_trials_not_just_preview(tmp_path):
    path=tmp_path/'run_events.tsv'
    path.write_text('onset\tduration\ttrial_id\ttrial_type\tchoice_acc\tresponse_time\tkey_press\n'
                    '0\t1\tpractice_trial\tgo\t0\t0.1\t-1\n'
                    '1\t1\ttest_trial\tgo\t1\t0.4\t32\n'
                    '2\t1\ttest_trial\tgo\t0\tn/a\t-1.0\n'
                    '3\t1\ttest_trial\tnogo\t1\tn/a\t-1\n')
    result=read_table(path,max_rows=1)
    metrics=result['behavior']
    assert metrics['test_trials']==3
    assert metrics['accuracy_denominator']==3
    assert metrics['choice_accuracy']==pytest.approx(2/3)
    assert metrics['median_response_time_s']==0.4
    assert metrics['go_omissions']==1
    assert metrics['no_keypress_trials']==2
    assert metrics['by_condition']['nogo']['choice_accuracy']==1


@pytest.mark.parametrize(('task','condition','expected'), [
    ('flanker','incongruent',2), ('goNogo','nogo_success',1),
    ('stopSignal','stop_success',1), ('stopSignalWFlanker','stop_success_congruent',1),
])
def test_omissions_use_task_response_requirements(tmp_path, task, condition, expected):
    path=tmp_path/f'sub-s03_task-{task}_events.tsv'
    path.write_text('onset\tduration\ttrial_id\ttrial_type\tkey_press\tcorrect_response\n'
                    '0\t1\ttest_trial\tgo\t-1\t32\n'
                    f'1\t1\ttest_trial\t{condition}\t-1\t32\n'
                    '2\t1\ttest_trial\twithhold\t-1\t-1\n'
                    '3\t1\ttest_cue\tgo\t-1\t32\n')
    assert read_table(path)['behavior']['omissions']==expected


def test_omissions_are_unknown_without_response_expectation(tmp_path):
    path=tmp_path/'sub-s03_task-flanker_events.tsv'
    path.write_text('onset\tduration\ttrial_id\ttrial_type\tkey_press\n0\t1\ttest_trial\tcongruent\t-1\n')
    assert read_table(path)['behavior']['omissions'] is None

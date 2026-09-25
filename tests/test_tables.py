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

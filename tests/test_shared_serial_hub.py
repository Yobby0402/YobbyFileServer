import os
import tempfile
import unittest

from yobboy_file_server.shared_serial_hub import (
    SOURCE_BROWSER_SERIAL,
    SOURCE_SERVER_PYSERIAL,
    SharedSerialHub,
    STATE_OFFLINE,
)


class SharedSerialHubTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.hub = SharedSerialHub(recent_limit=50, page_size=20, segment_entry_limit=25, segment_byte_limit=4096)
        self.hub.history_root = self.temp_dir.name
        os.makedirs(self.hub.history_root, exist_ok=True)

    def tearDown(self):
        self.hub.close()
        self.temp_dir.cleanup()

    def test_browser_owner_disconnect_stops_capture(self):
        channel = self.hub.register_browser_channel(
            owner_sid='owner-1',
            display_name='Browser Port',
            config={'baudrate': 115200, 'bytesize': 8, 'parity': 'N', 'stopbits': 1},
            browser_port={'usbVendorId': 1, 'usbProductId': 2},
        )
        self.assertEqual(channel['source_type'], SOURCE_BROWSER_SERIAL)

        capture, actions, error = self.hub.start_capture(channel['channel_id'], started_by='tester')
        self.assertIsNone(error)
        self.assertTrue(capture['active'])
        self.assertEqual(actions[0]['type'], 'browser_activate')

        changed, disconnect_actions = self.hub.handle_socket_disconnect('owner-1')
        self.assertEqual(disconnect_actions, [])
        updated = next(item for item in changed if item['channel_id'] == channel['channel_id'])
        self.assertEqual(updated['state'], STATE_OFFLINE)
        self.assertFalse(updated['capture_active'])
        self.assertEqual(self.hub.get_capture_sessions(), [])

    def test_server_capture_stop_requests_close_without_subscribers(self):
        channel, _created = self.hub.ensure_server_channel(
            device='COM3',
            config={'baudrate': 9600, 'bytesize': 8, 'parity': 'N', 'stopbits': 1},
        )
        self.assertEqual(channel['source_type'], SOURCE_SERVER_PYSERIAL)

        capture, actions, error = self.hub.start_capture(channel['channel_id'], started_by='tester')
        self.assertIsNone(error)
        self.assertEqual(actions[0]['type'], 'server_open')
        self.assertTrue(capture['active'])

        stopped, stop_actions, stop_error = self.hub.stop_capture(channel['channel_id'])
        self.assertIsNone(stop_error)
        self.assertFalse(stopped['active'])
        self.assertEqual(stop_actions[0]['type'], 'server_close')

    def test_relay_activates_channels_and_exposes_bidirectional_targets(self):
        first, _created = self.hub.ensure_server_channel(
            device='COM3',
            config={'baudrate': 9600, 'bytesize': 8, 'parity': 'N', 'stopbits': 1},
        )
        second, _created = self.hub.ensure_server_channel(
            device='COM4',
            config={'baudrate': 9600, 'bytesize': 8, 'parity': 'N', 'stopbits': 1},
        )

        relay, actions, error = self.hub.start_relay(
            first['channel_id'],
            second['channel_id'],
            started_by='tester',
        )

        self.assertIsNone(error)
        self.assertEqual([action['type'] for action in actions], ['server_open', 'server_open'])
        self.assertEqual(
            self.hub.get_relay_target(first['channel_id'])['target_channel']['channel_id'],
            second['channel_id'],
        )
        self.assertEqual(
            self.hub.get_relay_target(second['channel_id'])['target_channel']['channel_id'],
            first['channel_id'],
        )
        self.assertEqual(self.hub.get_channel(first['channel_id'])['relay_id'], relay['relay_id'])

    def test_relay_rejects_channel_reuse(self):
        channels = []
        for device in ('COM3', 'COM4', 'COM5'):
            channel, _created = self.hub.ensure_server_channel(
                device=device,
                config={'baudrate': 9600, 'bytesize': 8, 'parity': 'N', 'stopbits': 1},
            )
            channels.append(channel)

        relay, _actions, error = self.hub.start_relay(
            channels[0]['channel_id'],
            channels[1]['channel_id'],
        )
        self.assertIsNone(error)
        self.assertIsNotNone(relay)

        duplicate, duplicate_actions, duplicate_error = self.hub.start_relay(
            channels[0]['channel_id'],
            channels[2]['channel_id'],
        )
        self.assertIsNone(duplicate)
        self.assertEqual(duplicate_actions, [])
        self.assertEqual(duplicate_error, 'channel_already_relayed')

    def test_stop_relay_releases_idle_channels(self):
        first, _created = self.hub.ensure_server_channel(
            device='COM3',
            config={'baudrate': 9600, 'bytesize': 8, 'parity': 'N', 'stopbits': 1},
        )
        second, _created = self.hub.ensure_server_channel(
            device='COM4',
            config={'baudrate': 9600, 'bytesize': 8, 'parity': 'N', 'stopbits': 1},
        )
        relay, _actions, _error = self.hub.start_relay(first['channel_id'], second['channel_id'])

        stopped, stop_actions, stop_error = self.hub.stop_relay(relay['relay_id'])

        self.assertIsNone(stop_error)
        self.assertEqual(stopped['stop_reason'], 'manual')
        self.assertEqual([action['type'] for action in stop_actions], ['server_close', 'server_close'])
        self.assertEqual(self.hub.list_relays(), [])
        self.assertIsNone(self.hub.get_channel(first['channel_id'])['relay_id'])

    def test_browser_owner_disconnect_stops_relay(self):
        browser = self.hub.register_browser_channel(
            owner_sid='owner-1',
            display_name='Browser Port',
            config={'baudrate': 115200, 'bytesize': 8, 'parity': 'N', 'stopbits': 1},
            browser_port={'usbVendorId': 1, 'usbProductId': 2},
        )
        server, _created = self.hub.ensure_server_channel(
            device='COM3',
            config={'baudrate': 115200, 'bytesize': 8, 'parity': 'N', 'stopbits': 1},
        )
        relay, actions, error = self.hub.start_relay(browser['channel_id'], server['channel_id'])
        self.assertIsNone(error)
        self.assertIsNotNone(relay)
        self.assertEqual([action['type'] for action in actions], ['browser_activate', 'server_open'])

        changed, disconnect_actions = self.hub.handle_socket_disconnect('owner-1')

        self.assertEqual(self.hub.list_relays(), [])
        self.assertEqual(
            sorted(action['type'] for action in disconnect_actions),
            ['browser_sleep', 'server_close'],
        )
        updated = next(item for item in changed if item['channel_id'] == browser['channel_id'])
        self.assertEqual(updated['state'], STATE_OFFLINE)

    def test_history_paging_returns_latest_then_older_entries(self):
        channel, _created = self.hub.ensure_server_channel(
            device='COM7',
            config={'baudrate': 19200, 'bytesize': 8, 'parity': 'N', 'stopbits': 1},
        )
        channel_id = channel['channel_id']

        for index in range(1, 61):
            payload = f'line-{index:03d}'.encode('utf-8')
            self.hub.append_rx_entry(channel_id, payload)

        latest_entries, next_cursor, has_more, error = self.hub.get_history(channel_id, limit=20)
        self.assertIsNone(error)
        self.assertTrue(has_more)
        self.assertEqual(len(latest_entries), 20)
        self.assertEqual(latest_entries[0]['seq'], 41)
        self.assertEqual(latest_entries[-1]['seq'], 60)
        self.assertEqual(next_cursor, 41)

        older_entries, older_cursor, older_has_more, older_error = self.hub.get_history(
            channel_id,
            before_seq=next_cursor,
            limit=20,
        )
        self.assertIsNone(older_error)
        self.assertTrue(older_has_more)
        self.assertEqual(len(older_entries), 20)
        self.assertEqual(older_entries[0]['seq'], 21)
        self.assertEqual(older_entries[-1]['seq'], 40)
        self.assertEqual(older_cursor, 21)

    def test_history_after_returns_new_entries_in_order(self):
        channel, _created = self.hub.ensure_server_channel(
            device='COM8',
            config={'baudrate': 9600, 'bytesize': 8, 'parity': 'N', 'stopbits': 1},
        )
        channel_id = channel['channel_id']
        for index in range(1, 8):
            self.hub.append_rx_entry(channel_id, f'line-{index}'.encode('utf-8'))

        entries, next_cursor, has_more, error = self.hub.get_history_after(
            channel_id,
            after_seq=3,
            limit=3,
        )

        self.assertIsNone(error)
        self.assertEqual([entry['seq'] for entry in entries], [4, 5, 6])
        self.assertEqual(next_cursor, 6)
        self.assertTrue(has_more)


if __name__ == '__main__':
    unittest.main()

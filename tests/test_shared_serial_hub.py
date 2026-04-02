import os
import tempfile
import unittest

from shared_serial_hub import (
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


if __name__ == '__main__':
    unittest.main()

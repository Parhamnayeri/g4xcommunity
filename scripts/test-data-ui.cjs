require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { jsx: 'react', module: 'CommonJS', moduleResolution: 'node' },
});

const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { normalizePagination, computePageRange } = require('../frontend/src/utils/pagination');
const {
  DataTable,
  Pagination,
  StatusBadge,
  Drawer,
  Modal,
  Tabs,
  KpiCard,
  EmptyState,
  Skeleton,
  Input,
  Select,
  Textarea,
  Checkbox,
} = require('../frontend/src/components/ui');

// Mock global document for Drawer/Modal scroll-lock tests in node environment
global.document = {
  body: { style: { overflow: '' } },
  activeElement: null,
  addEventListener() {},
  removeEventListener() {},
};

let passed = 0;
function check(name, fn) {
  const result = fn();
  if (result && typeof result.then === 'function') {
    return result.then(() => {
      passed++;
      console.log(`PASS ${name}`);
    });
  }
  passed++;
  console.log(`PASS ${name}`);
}

async function runFoundationTests() {
  console.log('=== RUNNING G4X DATA UI SYSTEM FOUNDATION TESTS ===\n');

  // 1. Pagination Normalization Contract Defense
  check('normalizePagination correctly handles flat response', () => {
    const flat = { page: 2, limit: 10, total: 45, totalPages: 5, data: [] };
    const res = normalizePagination(flat);
    assert.deepEqual(res, { page: 2, limit: 10, total: 45, totalPages: 5 });
  });

  check('normalizePagination correctly handles nested { pagination: {...} } response', () => {
    const nested = {
      pagination: { page: 3, limit: 15, total: 100, totalPages: 7 },
      orders: [],
    };
    const res = normalizePagination(nested);
    assert.deepEqual(res, { page: 3, limit: 15, total: 100, totalPages: 7 });
  });

  check('normalizePagination safely defaults on null, undefined or empty input without undefined state', () => {
    for (const input of [null, undefined, {}, '', 123, []]) {
      const res = normalizePagination(input);
      assert.equal(res.page, 1);
      assert.equal(res.limit, 15);
      assert.equal(res.total, 0);
      assert.equal(res.totalPages, 1);
      assert(!Object.values(res).some((v) => v === undefined));
    }
  });

  check('normalizePagination calculates totalPages when backend totalPages is missing', () => {
    const res = normalizePagination({ page: 1, limit: 20, total: 55 });
    assert.equal(res.totalPages, 3);
  });

  check('computePageRange produces accurate 1-indexed ranges', () => {
    assert.deepEqual(computePageRange(1, 15, 35), { from: 1, to: 15 });
    assert.deepEqual(computePageRange(3, 15, 35), { from: 31, to: 35 });
    assert.deepEqual(computePageRange(1, 15, 0), { from: 0, to: 0 });
  });

  // 2. Component Render Tests
  const text = (renderer) => JSON.stringify(renderer.toJSON());

  await check('Pagination renders controls, range summary and Next/Previous buttons', () => {
    let renderer;
    let pageChange = 0;
    act(() => {
      renderer = create(
        React.createElement(Pagination, {
          page: 2,
          limit: 15,
          total: 45,
          totalPages: 3,
          onPageChange: (p) => {
            pageChange = p;
          },
        })
      );
    });

    const jsonStr = text(renderer);
    assert(jsonStr.includes('Showing'));
    assert(jsonStr.includes('16'));
    assert(jsonStr.includes('30'));
    assert(jsonStr.includes('45'));
    assert(jsonStr.includes('Next'));
    assert(jsonStr.includes('Previous'));

    const buttons = renderer.root.findAllByType('button');
    const nextBtn = buttons.find((b) => b.children.join('') === 'Next');
    assert(nextBtn);
    act(() => {
      nextBtn.props.onClick();
    });
    assert.equal(pageChange, 3);
  });

  await check('StatusBadge maps real backend statuses and supports simplifiedStatus', () => {
    let r1, r2, r3;
    act(() => {
      r1 = create(React.createElement(StatusBadge, { status: 'open_presign' }));
      r2 = create(React.createElement(StatusBadge, { status: 'verified' }));
      r3 = create(
        React.createElement(StatusBadge, {
          simplifiedStatus: { label: 'Custom Review', colorClass: 'badge-amber', rawStatus: 'staff_review' },
        })
      );
    });

    assert(text(r1).includes('Open Pre-sign'));
    assert(text(r1).includes('badge-green'));

    assert(text(r2).includes('Verified'));
    assert(text(r2).includes('badge-green'));

    assert(text(r3).includes('Custom Review'));
    assert(text(r3).includes('badge-amber'));
  });

  await check('DataTable renders headers, rows, numeric alignment, and row click', () => {
    let clickedItem = null;
    const columns = [
      { key: 'id', header: 'ID', numeric: true },
      { key: 'title', header: 'Title' },
    ];
    const data = [
      { id: 101, title: 'Item One' },
      { id: 102, title: 'Item Two' },
    ];

    let renderer;
    act(() => {
      renderer = create(
        React.createElement(DataTable, {
          columns,
          data,
          keyExtractor: (item) => item.id,
          onRowClick: (item) => {
            clickedItem = item;
          },
        })
      );
    });

    const json = text(renderer);
    assert(json.includes('Item One'));
    assert(json.includes('Item Two'));
    assert(json.includes('cell-numeric'));

    const rows = renderer.root.findAllByType('tr');
    // First row is header, second row is first data item
    act(() => {
      rows[1].props.onClick();
    });
    assert.deepEqual(clickedItem, { id: 101, title: 'Item One' });
  });

  await check('DataTable renders empty state when data is empty', () => {
    let renderer;
    act(() => {
      renderer = create(
        React.createElement(DataTable, {
          columns: [{ key: 'id', header: 'ID' }],
          data: [],
          keyExtractor: (i) => i.id,
          emptyTitle: 'No Records At All',
        })
      );
    });

    assert(text(renderer).includes('No Records At All'));
  });

  await check('DataTable renders skeletons when isLoading=true', () => {
    let renderer;
    act(() => {
      renderer = create(
        React.createElement(DataTable, {
          columns: [{ key: 'id', header: 'ID' }],
          data: [],
          keyExtractor: (i) => i.id,
          isLoading: true,
        })
      );
    });

    assert(text(renderer).includes('skeleton-box'));
  });

  await check('Drawer and Modal render with title and Close button', () => {
    let closed = false;
    let rDrawer, rModal;
    act(() => {
      rDrawer = create(
        React.createElement(Drawer, {
          isOpen: true,
          title: 'Order Details',
          onClose: () => {
            closed = true;
          },
          children: React.createElement('div', null, 'Drawer Content'),
        })
      );
      rModal = create(
        React.createElement(Modal, {
          isOpen: true,
          title: 'Confirm Action',
          onClose: () => {
            closed = true;
          },
          children: React.createElement('div', null, 'Modal Content'),
        })
      );
    });

    assert(text(rDrawer).includes('Order Details'));
    assert(text(rDrawer).includes('Drawer Content'));
    assert(text(rModal).includes('Confirm Action'));
    assert(text(rModal).includes('Modal Content'));

    const drawerClose = rDrawer.root.findAllByType('button').find((b) => b.children.join('') === 'Close');
    assert(drawerClose);
    act(() => {
      drawerClose.props.onClick();
    });
    assert(closed);
  });

  await check('Tabs renders tabs, active tab style, and handles tab selection', () => {
    let selectedTab = 'tab1';
    let renderer;
    const tabs = [
      { id: 'tab1', label: 'First Tab', count: 5 },
      { id: 'tab2', label: 'Second Tab', count: 0 },
    ];

    act(() => {
      renderer = create(
        React.createElement(Tabs, {
          tabs,
          activeTab: 'tab1',
          onChange: (id) => {
            selectedTab = id;
          },
        })
      );
    });

    assert(text(renderer).includes('First Tab'));
    assert(text(renderer).includes('tab-active'));
    assert(text(renderer).includes('5'));

    const buttons = renderer.root.findAllByType('button');
    act(() => {
      buttons[1].props.onClick();
    });
    assert.equal(selectedTab, 'tab2');
  });

  await check('FormControls (Input, Select, Textarea, Checkbox) render labels and errors', () => {
    let rInput, rSelect, rTextarea, rCheckbox;
    act(() => {
      rInput = create(React.createElement(Input, { label: 'Order Name', error: 'Name is required' }));
      rSelect = create(
        React.createElement(Select, {
          label: 'Game',
          options: [{ value: 'wow', label: 'World of Warcraft' }],
        })
      );
      rTextarea = create(React.createElement(Textarea, { label: 'Notes', helpText: 'Max 500 chars' }));
      rCheckbox = create(React.createElement(Checkbox, { label: 'Agree to terms' }));
    });

    assert(text(rInput).includes('Order Name'));
    assert(text(rInput).includes('Name is required'));
    assert(text(rSelect).includes('World of Warcraft'));
    assert(text(rTextarea).includes('Max 500 chars'));
    assert(text(rCheckbox).includes('Agree to terms'));
  });

  await check('KpiCard renders metric value and label', () => {
    let renderer;
    act(() => {
      renderer = create(
        React.createElement(KpiCard, {
          label: 'Total Revenue',
          value: '$12,450',
          subtext: '+12% from last week',
          highlight: 'lime',
        })
      );
    });

    assert(text(renderer).includes('Total Revenue'));
    assert(text(renderer).includes('$12,450'));
    assert(text(renderer).includes('highlight-lime'));
  });

  console.log(`\n====================================================`);
  console.log(`🎉 ALL ${passed} FOUNDATION TESTS PASSED!`);
  console.log(`====================================================`);
}

runFoundationTests().catch((err) => {
  console.error('Foundation test failure:', err);
  process.exit(1);
});

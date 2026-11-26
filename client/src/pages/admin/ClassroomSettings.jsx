import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import {
  Grid3X3,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertCircle,
  Info,
} from 'lucide-react';

const ClassroomSettings = () => {
  const [classrooms, setClassrooms] = useState([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState('');
  const [classroom, setClassroom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: '', text: '' });

  useEffect(() => {
    fetchClassrooms();
  }, []);

  useEffect(() => {
    if (selectedClassroomId) {
      loadClassroom(selectedClassroomId);
    }
  }, [selectedClassroomId]);

  const fetchClassrooms = async () => {
    try {
      setLoading(true);
      const res = await api.get('/classrooms');
      if (res.data.success && res.data.data.length > 0) {
        setClassrooms(res.data.data);
        if (!selectedClassroomId) {
          setSelectedClassroomId(res.data.data[0]._id);
        }
      }
    } catch (err) {
      console.error('Error fetching classrooms:', err);
      setStatusMsg({
        type: 'error',
        text: err.response?.data?.message || 'Failed to load classroom configurations. Please retry.',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadClassroom = async (id) => {
    try {
      setLoading(true);
      const res = await api.get(`/classrooms/${id}`);
      if (res.data.success) {
        setClassroom(res.data.data);
      }
    } catch (err) {
      console.error('Error loading classroom layout:', err);
      setStatusMsg({
        type: 'error',
        text: err.response?.data?.message || 'Failed to load classroom seating grid.',
      });
    } finally {
      setLoading(false);
    }
  };

  // Layout Modification Actions
  const handleAddRow = () => {
    if (!classroom) return;
    const nextRowNumber = (classroom.rows?.length || 0) + 1;
    // Add default 5 benches with 5 seats each
    const newBenches = [];
    for (let b = 1; b <= 5; b++) {
      const seats = [];
      for (let s = 1; s <= 5; s++) {
        seats.push({
          seatId: `R${nextRowNumber}-B${b}-S${s}`,
          seatNumber: s,
          isAvailable: true,
        });
      }
      newBenches.push({ benchNumber: b, capacity: 5, seats });
    }

    setClassroom({
      ...classroom,
      rows: [...(classroom.rows || []), { rowNumber: nextRowNumber, benches: newBenches }],
    });
  };

  const handleRemoveRow = (rowIndex) => {
    if (!classroom || classroom.rows.length <= 1) {
      alert('Classroom must have at least one row.');
      return;
    }
    const updatedRows = classroom.rows
      .filter((_, idx) => idx !== rowIndex)
      .map((row, rIdx) => {
        const rowNum = rIdx + 1;
        return {
          ...row,
          rowNumber: rowNum,
          benches: row.benches.map((b) => ({
            ...b,
            seats: b.seats.map((s) => ({
              ...s,
              seatId: `R${rowNum}-B${b.benchNumber}-S${s.seatNumber}`,
            })),
          })),
        };
      });

    setClassroom({ ...classroom, rows: updatedRows });
  };

  const handleAddBench = (rowIndex) => {
    const updatedRows = [...classroom.rows];
    const row = updatedRows[rowIndex];
    const nextBenchNum = row.benches.length + 1;
    const seats = [];
    for (let s = 1; s <= 5; s++) {
      seats.push({
        seatId: `R${row.rowNumber}-B${nextBenchNum}-S${s}`,
        seatNumber: s,
        isAvailable: true,
      });
    }
    row.benches.push({ benchNumber: nextBenchNum, capacity: 5, seats });
    setClassroom({ ...classroom, rows: updatedRows });
  };

  const handleRemoveBench = (rowIndex, benchIndex) => {
    const updatedRows = [...classroom.rows];
    const row = updatedRows[rowIndex];
    if (row.benches.length <= 1) {
      alert('Each row must contain at least one bench.');
      return;
    }
    row.benches = row.benches
      .filter((_, idx) => idx !== benchIndex)
      .map((b, bIdx) => {
        const bNum = bIdx + 1;
        return {
          ...b,
          benchNumber: bNum,
          seats: b.seats.map((s) => ({
            ...s,
            seatId: `R${row.rowNumber}-B${bNum}-S${s.seatNumber}`,
          })),
        };
      });
    setClassroom({ ...classroom, rows: updatedRows });
  };

  const handleAddSeatToBench = (rowIndex, benchIndex) => {
    const updatedRows = [...classroom.rows];
    const bench = updatedRows[rowIndex].benches[benchIndex];
    const rowNum = updatedRows[rowIndex].rowNumber;
    const nextSeatNum = bench.seats.length + 1;

    bench.seats.push({
      seatId: `R${rowNum}-B${bench.benchNumber}-S${nextSeatNum}`,
      seatNumber: nextSeatNum,
      isAvailable: true,
    });
    bench.capacity = bench.seats.length;
    setClassroom({ ...classroom, rows: updatedRows });
  };

  const handleRemoveSeatFromBench = (rowIndex, benchIndex) => {
    const updatedRows = [...classroom.rows];
    const bench = updatedRows[rowIndex].benches[benchIndex];
    if (bench.seats.length <= 1) {
      alert('A bench must have at least one seat.');
      return;
    }
    bench.seats.pop();
    bench.capacity = bench.seats.length;
    setClassroom({ ...classroom, rows: updatedRows });
  };

  const toggleSeatAvailability = (rowIndex, benchIndex, seatIndex) => {
    const updatedRows = [...classroom.rows];
    const seat = updatedRows[rowIndex].benches[benchIndex].seats[seatIndex];
    seat.isAvailable = !seat.isAvailable;
    setClassroom({ ...classroom, rows: updatedRows });
  };

  const calculateTotalAndAvailable = () => {
    let enabledCount = 0;
    let disabledCount = 0;
    let totalPhysical = 0;
    if (classroom?.rows) {
      classroom.rows.forEach((r) => {
        r.benches.forEach((b) => {
          b.seats.forEach((s) => {
            totalPhysical++;
            if (s.isAvailable !== false) {
              enabledCount++;
            } else {
              disabledCount++;
            }
          });
        });
      });
    }
    // Capacity is strictly derived from enabled physical seats; disabled seats do not count towards capacity
    return {
      total: enabledCount,
      available: enabledCount,
      disabled: disabledCount,
      totalPhysical,
    };
  };

  const handleSaveClassroom = async () => {
    try {
      setSaving(true);
      setStatusMsg({ type: '', text: '' });
      const res = await api.put(`/classrooms/${classroom._id}`, classroom);
      if (res.data.success) {
        setClassroom(res.data.data);
        setStatusMsg({
          type: 'success',
          text: `Classroom configuration saved! Current capacity: ${res.data.data.totalCapacity} seats (${res.data.data.availableCapacity} available).`,
        });
      }
    } catch (err) {
      setStatusMsg({
        type: 'error',
        text: err.response?.data?.message || 'Failed to save classroom layout.',
      });
    } finally {
      setSaving(false);
    }
  };

  const { total, available, disabled, totalPhysical } = calculateTotalAndAvailable();

  return (
    <div className="space-y-6">
      {/* Page Title & Classroom Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-navy-800 tracking-tight">Classroom Seating Editor</h1>
          <p className="text-xs text-slate-500 mt-1">
            Configure rows, benches, seats per bench, and toggle seat availability (72-seat capacity)
          </p>
        </div>

        <div className="mt-3 sm:mt-0 flex flex-wrap items-center gap-2">
          <div className="flex items-center space-x-1.5">
            <label className="text-xs font-bold text-navy-800">Select Classroom:</label>
            <select
              value={selectedClassroomId}
              onChange={(e) => setSelectedClassroomId(e.target.value)}
              className="px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg bg-white shadow-xs focus:ring-1 focus:ring-primary"
            >
              {classrooms.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name} ({c.floor || 'ET Block'}) — {c.totalCapacity || 72} seats
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleSaveClassroom}
            disabled={saving}
            className="inline-flex items-center px-4 py-2 text-xs font-semibold rounded-lg text-white bg-primary hover:bg-primary-hover shadow-sm disabled:opacity-50 transition-colors"
          >
            <Save size={14} className="mr-1.5" />
            {saving ? 'Saving Layout...' : 'Save Configuration'}
          </button>
        </div>
      </div>

      {statusMsg.text && (
        <div
          className={`p-3.5 rounded-lg text-xs flex items-center border ${statusMsg.type === 'success'
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
            : 'bg-red-50 text-red-700 border-red-200'
            }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 size={16} className="mr-2 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle size={16} className="mr-2 text-red-600 flex-shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Classroom Details & Metric Bar */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-primary/10 text-primary rounded-xl">
            <Grid3X3 size={24} />
          </div>
          <div>
            <h2 className="text-sm font-bold text-navy-800">{classroom?.name || 'Hall A-101'}</h2>
            <p className="text-xs text-slate-500">
              Room {classroom?.roomNumber} • {classroom?.block} • {classroom?.floor}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs flex-wrap">
          <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-center">
            <div className="text-[10px] uppercase text-slate-500 font-semibold">Total Capacity</div>
            <div className="text-lg font-bold text-navy-800">{total} seats</div>
          </div>
          <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
            <div className="text-[10px] uppercase text-emerald-600 font-semibold">Available Seats</div>
            <div className="text-lg font-bold text-emerald-700">{available} seats</div>
          </div>
          {disabled > 0 && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-center">
              <div className="text-[10px] uppercase text-red-600 font-semibold">Disabled (Off)</div>
              <div className="text-lg font-bold text-red-600">{disabled} seats</div>
            </div>
          )}
          <div className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-center">
            <div className="text-[10px] uppercase text-slate-500 font-semibold">72-Seat Requirement</div>
            <div className="text-lg font-bold text-primary">
              {available >= 72 ? '✓ Satisfied (72)' : `Needs ${72 - available} more`}
            </div>
          </div>
        </div>
      </div>

      {/* Blackboard Front Indicator */}
      <div className="w-full py-2.5 bg-navy-800 text-white text-center rounded-lg text-xs font-semibold shadow-sm tracking-wider uppercase">
        Blackboard / Instructor Podium (Front of Hall)
      </div>

      {/* Top-Down Layout Visual Editor */}
      <div className="space-y-6">
        {classroom?.rows?.map((row, rIdx) => (
          <div
            key={row.rowNumber}
            className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-navy-800 text-sm">Row {row.rowNumber}</span>
                <span className="text-xs text-slate-600">
                  ({row.benches.reduce((acc, b) => acc + b.seats.length, 0)} seats across {row.benches.length} benches)
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => handleAddBench(rIdx)}
                  className="px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 rounded-md transition-colors"
                >
                  + Add Bench to Row {row.rowNumber}
                </button>
                <button
                  type="button"
                  onClick={() => handleRemoveRow(rIdx)}
                  aria-label={`Remove row ${row.rowNumber}`}
                  className="p-1 text-slate-500 hover:text-red-600 rounded transition-colors"
                  title="Remove this entire row"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Benches in this Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 pt-1">
              {row.benches.map((bench, bIdx) => (
                <div
                  key={bench.benchNumber}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-navy-800 uppercase">
                      Bench {bench.benchNumber}
                    </span>
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => handleAddSeatToBench(rIdx, bIdx)}
                        aria-label={`Add seat to bench ${bench.benchNumber}`}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-300 hover:border-primary text-slate-700 font-bold"
                        title="Add seat"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveSeatFromBench(rIdx, bIdx)}
                        aria-label={`Remove seat from bench ${bench.benchNumber}`}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-slate-300 hover:border-red-500 text-slate-700 font-bold"
                        title="Remove seat"
                      >
                        -
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveBench(rIdx, bIdx)}
                        aria-label={`Delete bench ${bench.benchNumber}`}
                        className="p-0.5 text-slate-500 hover:text-red-600"
                        title="Delete bench"
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Seat Blocks on Bench */}
                  <div className="flex flex-wrap gap-1.5">
                    {bench.seats.map((seat, sIdx) => (
                      <button
                        key={seat.seatId}
                        type="button"
                        onClick={() => toggleSeatAvailability(rIdx, bIdx, sIdx)}
                        title={`Click to toggle: ${seat.seatId} (${seat.isAvailable ? 'Available' : 'Unavailable'})`}
                        className={`flex-1 min-w-[36px] py-2 px-1 text-center rounded border transition-all text-xs font-semibold ${seat.isAvailable
                          ? 'bg-white border-slate-300 text-navy-800 hover:border-primary hover:shadow-xs'
                          : 'bg-red-50 border-red-300 text-red-700 line-through'
                          }`}
                      >
                        <div className="text-[10px] text-slate-600 font-normal">S{seat.seatNumber}</div>
                        <div className="text-[11px] font-mono mt-0.5">
                          {seat.isAvailable ? 'Seat' : 'Off'}
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="text-[10px] text-slate-600 text-center pt-1 border-t border-slate-200">
                    {bench.seats.filter((s) => s.isAvailable).length} / {bench.seats.length} Available
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Add Row Button */}
      <div className="text-center pt-2">
        <button
          onClick={handleAddRow}
          className="inline-flex items-center px-4 py-2 border border-dashed border-slate-300 hover:border-primary rounded-xl text-xs font-semibold text-slate-700 hover:text-primary bg-white shadow-xs transition-colors"
        >
          <Plus size={15} className="mr-1.5" />
          Add New Row to Classroom
        </button>
      </div>

      {/* Helper Legend */}
      <div className="bg-slate-50 border border-slate-200 p-4 rounded-xl text-xs text-slate-600 flex items-start space-x-3">
        <Info size={18} className="text-primary flex-shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold text-navy-800">Classroom Adjacency & Seating Notice</div>
          <p className="text-[11px]">
            Every seat has a unique identifier in the format <code className="bg-white px-1 py-0.5 rounded border border-slate-200 font-mono">R[Row]-B[Bench]-S[Seat]</code>.
            Click on any seat to toggle its availability (e.g., damaged or reserved seats).
            The allocation engine will automatically obey the bench adjacency rule: no two adjacent seats on the same bench will receive the same question paper set (A, B, C).
          </p>
        </div>
      </div>
    </div>
  );
};

export default ClassroomSettings;

/*
 * Copyright 2013 Renaud Gaudin <reg@kiwix.org>
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU  General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or
 * any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston,
 * MA 02110-1301, USA.
 */

#include "CTPP2VMStringLoader.hpp"

namespace CTPP // C++ Template Engine
{

//
// Convert byte order
//
static void ConvertExecutable(VMExecutable * oCore)
{
	// Code entry point
	oCore -> entry_point = Swap32(oCore -> entry_point);
	// Offset of code segment
	oCore -> code_offset = Swap32(oCore -> code_offset);

	// Code segment size
	oCore -> code_size   = Swap32(oCore -> code_size);

	// Offset of static text segment
	oCore -> syscalls_offset    = Swap32(oCore -> syscalls_offset);
	// Static text segment size
	oCore -> syscalls_data_size = Swap32(oCore -> syscalls_data_size);

	// Offset of static text index segment
	oCore -> syscalls_index_offset = Swap32(oCore -> syscalls_index_offset);
	// Static text index segment size
	oCore -> syscalls_index_size   = Swap32(oCore -> syscalls_index_size);

	// Offset of static data segment
	oCore -> static_data_offset    = Swap32(oCore -> static_data_offset);

	// Static data segment size
	oCore -> static_data_data_size = Swap32(oCore -> static_data_data_size);

	// Offset of static text segment
	oCore -> static_text_offset    = Swap32(oCore -> static_text_offset);
	// Static text segment size
	oCore -> static_text_data_size = Swap32(oCore -> static_text_data_size);

	// Offset of static text index segment
	oCore -> static_text_index_offset = Swap32(oCore -> static_text_index_offset);
	// Static text index segment size
	oCore -> static_text_index_size   = Swap32(oCore -> static_text_index_size);

	// Version 2.2+
	// Offset of static data bit index
	oCore -> static_data_bit_index_offset = Swap32(oCore -> static_data_bit_index_offset);
	/// Offset of static data bit index
	oCore -> static_data_bit_index_size = Swap32(oCore -> static_data_bit_index_size);

	// Platform
	oCore -> platform      = Swap64(oCore -> platform);

	// Ugly-jolly hack!
	// ... dereferencing type-punned pointer will break strict-aliasing rules ...
	UINT_64 iTMP;
	memcpy(&iTMP, &(oCore -> ieee754double), sizeof(UINT_64));
	iTMP = Swap64(iTMP);
	memcpy(&(oCore -> ieee754double), &iTMP, sizeof(UINT_64));

	// Cyclic Redundancy Check
	oCore -> crc = 0;

	// Convert data structures

	// Convert code segment
	VMInstruction * pInstructions = const_cast<VMInstruction *>(VMExecutable::GetCodeSeg(oCore));
	UINT_32 iI = 0;
	UINT_32 iSteps = oCore -> code_size / sizeof(VMInstruction);
	for(iI = 0; iI < iSteps; ++iI)
	{
		pInstructions -> instruction = Swap32(pInstructions -> instruction);
		pInstructions -> argument    = Swap32(pInstructions -> argument);
		pInstructions -> reserved    = Swap64(pInstructions -> reserved);
		++pInstructions;
	}

	// Convert syscalls index
	TextDataIndex * pTextIndex = const_cast<TextDataIndex *>(VMExecutable::GetSyscallsIndexSeg(oCore));
	iSteps = oCore -> syscalls_index_size / sizeof(TextDataIndex);
	for(iI = 0; iI < iSteps; ++iI)
	{
		pTextIndex -> offset = Swap32(pTextIndex -> offset);
		pTextIndex -> length = Swap32(pTextIndex -> length);
		++pTextIndex;
	}

	// Convert static text index
	pTextIndex = const_cast<TextDataIndex *>(VMExecutable::GetStaticTextIndexSeg(oCore));
	iSteps = oCore -> static_text_index_size / sizeof(TextDataIndex);
	for(iI = 0; iI < iSteps; ++iI)
	{
		pTextIndex -> offset = Swap32(pTextIndex -> offset);
		pTextIndex -> length = Swap32(pTextIndex -> length);
		++pTextIndex;
	}

	// Convert static data
	StaticDataVar * pStaticDataVar = const_cast<StaticDataVar *>(VMExecutable::GetStaticDataSeg(oCore));
	iSteps = oCore -> static_data_data_size / sizeof(StaticDataVar);
	for(iI = 0; iI < iSteps; ++iI)
	{
		(*pStaticDataVar).i_data = Swap64((*pStaticDataVar).i_data);
		++pStaticDataVar;
	}
}

//
// Constructor
//
VMStringLoader::VMStringLoader(CCHAR_P rawContent, size_t rawContentSize)
{
    oCore = (VMExecutable *)malloc(rawContentSize + 1);
    memcpy(oCore, rawContent, rawContentSize);

	if (oCore -> magic[0] == 'C' &&
	    oCore -> magic[1] == 'T' &&
	    oCore -> magic[2] == 'P' &&
	    oCore -> magic[3] == 'P')
	{
		// Check version
		if (oCore -> version[0] >= 1)
		{
			// Platform-dependent data (byte order)
			if (oCore -> platform == 0x4142434445464748ull)
			{
#ifdef _DEBUG
				fprintf(stderr, "Big/Little Endian conversion: Nothing to do\n");
#endif

				// Nothing to do, only check crc
				UINT_32 iCRC = oCore -> crc;
				oCore -> crc = 0;

				// Calculate CRC of file
                // KELSON: next line used to refer to oStat.st_size
                // changed it to rawContentSize
				if (iCRC != crc32((UCCHAR_P)oCore, rawContentSize))
				{
					free(oCore);
					throw CTPPLogicError("CRC checksum invalid");
				}
			}
			// Platform-dependent data (byte order)
			else if (oCore -> platform == 0x4847464544434241ull)
			{
				// Need to reconvert data
#ifdef _DEBUG
				fprintf(stderr, "Big/Little Endian conversion: Need to reconvert core\n");
#endif
				ConvertExecutable(oCore);
			}
			else
			{
				free(oCore);
				throw CTPPLogicError("Conversion of middle-end architecture does not supported.");
			}

			// Check IEEE 754 format
			if (oCore -> ieee754double != 15839800103804824402926068484019465486336.0)
			{
				free(oCore);
				throw CTPPLogicError("IEEE 754 format is broken, cannot convert file");
			}
		}

		pVMMemoryCore = new VMMemoryCore(oCore);
	}
	else
	{
		free(oCore);
		throw CTPPLogicError("Not an CTPP bytecode file.");
	}
}

//
// Get ready-to-run program
//
const VMMemoryCore * VMStringLoader::GetCore() const { return pVMMemoryCore; }

//
// A destructor
//
VMStringLoader::~VMStringLoader() throw()
{
	delete pVMMemoryCore;
	free(oCore);
}

} // namespace CTPP
// End.
